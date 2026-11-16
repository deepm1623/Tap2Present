
import { auth, db } from "../../firebase-config.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs,
    setDoc,
    updateDoc,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// ==========================================
// HTML ELEMENTS
// ==========================================

const subjectInput = document.getElementById("subjectInput");
const dateDisplay = document.getElementById("dateDisplay");

const startButton = document.getElementById("startScannerButton");
const stopButton = document.getElementById("stopScannerButton");
const logoutButton = document.getElementById("logoutButton");

const scannerTitle = document.getElementById("scannerTitle");
const scannerDescription = document.getElementById("scannerDescription");
const readerIndicator = document.getElementById("readerIndicator");
const nfcAnimation = document.getElementById("nfcAnimation");

const scanResult = document.getElementById("scanResult");
const scanTableBody = document.getElementById("scanTableBody");
const scanCount = document.getElementById("scanCount");

const facultyName = document.getElementById("facultyName");
const facultyInitial = document.getElementById("facultyInitial");

// ==========================================
// VARIABLES
// ==========================================

let currentUser = null;
let ndef = null;
let scanning = false;
let processingCard = false;
let recentScans = [];
let scanAbortController = null;
let sessionRef = null;
let currentUserProfile = null;

// ==========================================
// DATE AND TIME
// ==========================================

function getLocalDate() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function getLocalTime() {
    return new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

dateDisplay.value = getLocalDate();

// ==========================================
// AUTHENTICATION
// ==========================================

onAuthStateChanged(auth, async function (user) {
    if (!user) {
        window.location.href = "faculty-login.html";
        return;
    }

    try {
        const userSnapshot = await getDoc(
            doc(db, "users", user.uid)
        );

        if (!userSnapshot.exists()) {
            await signOut(auth);
            window.location.href = "faculty-login.html";
            return;
        }

        const userData = userSnapshot.data();

        if (userData.role !== "faculty") {
            await signOut(auth);
            window.location.href = "../login.html";
            return;
        }

        if (userData.status !== "active") {
            await signOut(auth);
            window.location.href = "faculty-login.html";
            return;
        }

        currentUser = user;
        currentUserProfile = userData;

        const name = userData.name || "Faculty";

        facultyName.textContent = name;
        facultyInitial.textContent = name.charAt(0).toUpperCase();

    } catch (error) {
        console.error("Authentication error:", error);

        showResult(
            "Account verification failed",
            error.message,
            "error"
        );
    }
});

// ==========================================
// START NFC SCANNER
// ==========================================

startButton.addEventListener("click", async function () {

    if (!currentUser) {
        showResult(
            "Not logged in",
            "Please log in again.",
            "error"
        );
        return;
    }

    if (!subjectInput.value.trim()) {
        showResult(
            "Subject required",
            "Enter the subject first.",
            "error"
        );

        subjectInput.focus();
        return;
    }

    if (!("NDEFReader" in window)) {
        showResult(
            "NFC not supported",
            "Use a supported Android phone and Chrome browser.",
            "error"
        );
        return;
    }

    try {
        ndef = new NDEFReader();
        scanAbortController = new AbortController();

        ndef.addEventListener(
            "reading",
            handleNfcReading
        );

        ndef.addEventListener("readingerror", function () {
            showResult(
                "Card reading failed",
                "Could not read the card. Try tapping it again.",
                "error"
            );
        });

        await ndef.scan({
            signal: scanAbortController.signal
        });

        sessionRef = await createAttendanceSession();
        scanning = true;

        startButton.disabled = true;
        stopButton.disabled = false;

        readerIndicator.textContent = "Session active";
        readerIndicator.className = "reader-indicator active";

        scannerTitle.textContent = "Scanner is active";

        scannerDescription.textContent =
            "Bring a student's NDEF card close to your phone.";

        nfcAnimation.classList.add("scanning");

        showResult(
            "Scanner ready",
            "NFC is active. Tap a student card against your phone.",
            "success"
        );

    } catch (error) {
        console.error("NFC start error:", error);

        if (scanAbortController) {
            scanAbortController.abort();
            scanAbortController = null;
        }
        scanning = false;

        showResult(
            "Unable to start NFC",
            getNfcErrorMessage(error),
            "error"
        );
    }
});

// ==========================================
// NFC READING EVENT
// ==========================================

async function handleNfcReading(event) {

    if (processingCard || !scanning) {
        return;
    }

    processingCard = true;

    try {
        console.log("========== NFC SCAN ==========");
        console.log("NFC event:", event);
        console.log("NDEF records:", event.message.records);

        const studentCode = readStudentCode(event.message);

        if (!studentCode) {
            const diagnostics = getNfcDiagnostics(event.message);

            console.error("NFC diagnostic:", diagnostics);

            showResult(
                "Invalid NFC card",
                diagnostics,
                "error"
            );

            return;
        }

        console.log("Extracted student ID:", studentCode);

        await window.withLoading(
            () => markStudentAttendance(studentCode),
            "Verifying the card and saving attendance.",
            "Processing NFC scan"
        );

    } catch (error) {
        console.error("Card processing error:", error);

        showResult(
            "Attendance failed",
            getFriendlyError(error),
            "error"
        );

    } finally {
        setTimeout(function () {
            processingCard = false;
        }, 1500);
    }
}

// ==========================================
// CONVERT NFC DATA TO BYTES
// ==========================================

function getRecordBytes(data) {

    if (!data) {
        return null;
    }

    if (data instanceof DataView) {
        return new Uint8Array(
            data.buffer,
            data.byteOffset,
            data.byteLength
        );
    }

    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }

    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(
            data.buffer,
            data.byteOffset,
            data.byteLength
        );
    }

    return null;
}

// ==========================================
// CLEAN NFC TEXT
// ==========================================

function cleanNfcText(text) {
    return text
        .replace(/^\uFEFF/, "")
        .replace(/\0/g, "")
        .replace(/[\u200B-\u200D\u2060]/g, "")
        .trim();
}

// ==========================================
// DECODE NFC TEXT
// ==========================================

function decodeNfcText(bytes) {

    if (!bytes || bytes.length === 0) {
        return "";
    }

    // First try the complete byte array as plain UTF-8.
    // Your card currently sends this format.

    const rawText = cleanNfcText(
        new TextDecoder("utf-8").decode(bytes)
    );

    if (/^TAP2P\s*:/i.test(rawText)) {
        console.log("NFC format detected: Plain UTF-8");
        return rawText;
    }

    // If plain UTF-8 did not match, try standard NDEF Text Record.

    const statusByte = bytes[0];

    const isUTF16 = (statusByte & 0x80) !== 0;
    const languageLength = statusByte & 0x3F;

    const textStart = 1 + languageLength;

    if (textStart > bytes.length) {
        return rawText;
    }

    const textBytes = bytes.slice(textStart);

    const decoder = new TextDecoder(
        isUTF16 ? "utf-16" : "utf-8"
    );

    const standardText = cleanNfcText(
        decoder.decode(textBytes)
    );

    console.log("NFC format detected: Standard NDEF text");

    return standardText;
}

// ==========================================
// EXTRACT STUDENT ID
// ==========================================

function readStudentCode(message) {

    if (!message || !message.records) {
        console.error("NDEF message is empty.");
        return null;
    }

    for (const record of message.records) {

        console.log("Record type:", record.recordType);

        if (record.recordType !== "text") {
            continue;
        }

        const bytes = getRecordBytes(record.data);

        if (!bytes || bytes.length === 0) {
            continue;
        }

        console.log("NFC raw bytes:", Array.from(bytes));

        try {
            const decodedText = decodeNfcText(bytes);

            console.log(
                "Decoded NFC text:",
                JSON.stringify(decodedText)
            );

            const cleanedText = cleanNfcText(decodedText);

            console.log("Cleaned NFC text:", cleanedText);

            const match = cleanedText.match(
                /^TAP2P\s*:\s*([A-Za-z0-9_-]{1,40})$/i
            );

            if (match) {
                return match[1].trim().toUpperCase();
            }

        } catch (error) {
            console.error("NFC decoding error:", error);
        }
    }

    return null;
}

// ==========================================
// NFC DIAGNOSTICS
// ==========================================

function getNfcDiagnostics(message) {

    if (!message || !message.records || message.records.length === 0) {
        return "No NDEF records were found on the card.";
    }

    return message.records.map(function (record, index) {

        const bytes = getRecordBytes(record.data);

        const rawBytes = bytes
            ? Array.from(bytes).join(",")
            : "No data";

        let decoded = "Not a text record";

        if (record.recordType === "text" && bytes) {
            try {
                decoded = decodeNfcText(bytes);
            } catch (error) {
                decoded = "Decoding failed";
            }
        }

        return (
            "Record " + (index + 1) +
            " | Type: " + record.recordType +
            " | Bytes: " + rawBytes +
            " | Text: " + decoded
        );

    }).join(" || ");
}

// ==========================================
// FIND STUDENT AND MARK ATTENDANCE
// ==========================================

async function markStudentAttendance(studentCode) {

    const subject = subjectInput.value.trim();
    const date = getLocalDate();
    const time = getLocalTime();

    // Find student using studentId
    const studentQuery = query(
        collection(db, "users"),
        where("studentId", "==", studentCode),
        where("role", "==", "student")
    );

    const studentSnapshot = await getDocs(studentQuery);

    if (studentSnapshot.empty) {
        showResult(
            "Student not found",
            `No student registered with ID ${studentCode}.`,
            "error"
        );
        return;
    }

    if (studentSnapshot.size > 1) {
        showResult(
            "Duplicate student ID",
            "More than one student has this ID. Contact the administrator.",
            "error"
        );
        return;
    }

    const studentDocument = studentSnapshot.docs[0];
    const student = studentDocument.data();

    if (student.status !== "active") {
        showResult(
            "Account not active",
            `${student.name || studentCode} is not approved yet.`,
            "error"
        );
        return;
    }

    const attendanceId = createAttendanceId(
        studentDocument.id,
        date,
        subject
    );

    const attendanceRef = doc(
        db,
        "attendance",
        attendanceId
    );

    // Prevent duplicate attendance
    let result;
    const attendanceLoading = await window.showLoading(
        "Saving the attendance record.",
        "Saving attendance"
    );

    try {
        result = await runTransaction(
            db,
            async function (transaction) {

                const existingRecord = await transaction.get(
                    attendanceRef
                );

                if (existingRecord.exists()) {
                    return false;
                }

                transaction.set(attendanceRef, {
                    studentId: studentDocument.id,
                    studentCode: studentCode,
                    studentName: student.name || "Student",
                    subject: subject,
                    date: date,
                    time: time,
                    status: "present",
                    scannedBy: currentUser.uid,
                    createdAt: serverTimestamp()
                });

                return true;
            }
        );
    } finally {
        attendanceLoading.close();
    }

    if (!result) {
        showResult(
            "Already marked",
            `${student.name || studentCode} has already been marked present for ${subject} today.`,
            "error"
        );
        return;
    }

    showResult(
        "Attendance successful!",
        `${student.name || "Student"} (${studentCode}) — ${subject}`,
        "success"
    );
    window.showToast(
        `${student.name || "Student"} was marked present for ${subject}.`,
        "success",
        "Attendance saved"
    );

    addScanToTable({
        studentCode: studentCode,
        studentName: student.name || "Student",
        time: time
    });
}

// ==========================================
// CREATE ATTENDANCE DOCUMENT ID
// ==========================================

function createAttendanceId(studentUid, date, subject) {

    const safeSubject = subject
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    return `${studentUid}_${date}_${safeSubject}`;
}

// ==========================================
// SHOW RESULT
// ==========================================

function showResult(title, description, type) {

    scanResult.className = "scan-result " + type;
    scanResult.innerHTML = "";

    const icon = document.createElement("div");
    icon.className = "result-icon";
    icon.textContent = type === "success" ? "✓" : "NFC";

    const content = document.createElement("div");

    const heading = document.createElement("h3");
    heading.textContent = title;

    const paragraph = document.createElement("p");
    paragraph.textContent = description;

    paragraph.style.overflowWrap = "anywhere";
    paragraph.style.wordBreak = "break-word";

    content.appendChild(heading);
    content.appendChild(paragraph);

    scanResult.appendChild(icon);
    scanResult.appendChild(content);
}

// ==========================================
// ADD SUCCESSFUL SCAN TO TABLE
// ==========================================

function addScanToTable(student) {

    recentScans.unshift(student);

    scanCount.textContent = recentScans.length + " scanned";

    scanTableBody.innerHTML = "";

    recentScans.forEach(function (item) {

        const row = document.createElement("tr");

        const idCell = document.createElement("td");
        idCell.textContent = item.studentCode;

        const nameCell = document.createElement("td");
        nameCell.textContent = item.studentName;

        const timeCell = document.createElement("td");
        timeCell.textContent = item.time;

        const statusCell = document.createElement("td");

        const badge = document.createElement("span");
        badge.className = "table-status";
        badge.textContent = "Present";

        statusCell.appendChild(badge);

        row.appendChild(idCell);
        row.appendChild(nameCell);
        row.appendChild(timeCell);
        row.appendChild(statusCell);

        scanTableBody.appendChild(row);
    });
}

// ==========================================
// STOP NFC SCANNER
// ==========================================

stopButton.addEventListener("click", stopScanner);

function stopScanner() {

    if (scanAbortController) {
        scanAbortController.abort();
        scanAbortController = null;
    }

    scanning = false;
    processingCard = false;
    ndef = null;

    const hadSession = Boolean(sessionRef);
    if (sessionRef) {
        const activeSession = sessionRef;
        sessionRef = null;
        stopAttendanceSession(activeSession)
            .then(function () {
                readerIndicator.textContent = "Session ended";
                readerIndicator.className = "reader-indicator";
            })
            .catch(function (error) {
                console.error("Attendance session stop error:", error);
                showResult(
                    "Session update failed",
                    "The scanner stopped, but the attendance session could not be updated.",
                    "error"
                );
            });
    }

    startButton.disabled = false;
    stopButton.disabled = true;

    readerIndicator.textContent = hadSession ? "Session ending" : "Not Started";
    readerIndicator.className = hadSession ? "reader-indicator active" : "reader-indicator";

    scannerTitle.textContent = "Scanner stopped";

    scannerDescription.textContent =
        "Start the scanner when you are ready.";

    nfcAnimation.classList.remove("scanning");
}

async function createAttendanceSession() {
    const subject = subjectInput.value.trim();
    const activeSessions = await getDocs(query(
        collection(db, "sessions"),
        where("facultyUid", "==", currentUser.uid),
        where("status", "==", "active")
    ));

    await Promise.all(activeSessions.docs.map(function (activeSession) {
        return updateDoc(activeSession.ref, {
            status: "stopped",
            endedAt: serverTimestamp()
        });
    }));

    const newSessionRef = doc(collection(db, "sessions"));
    const sessionData = {
        sessionId: newSessionRef.id,
        facultyUid: currentUser.uid,
        facultyName: currentUserProfile.name || "Faculty",
        subject: subject,
        subjectName: subject,
        status: "active",
        startedAt: serverTimestamp(),
        endedAt: null
    };

    ["classId", "className", "semester", "division"].forEach(function (field) {
        if (currentUserProfile[field] !== undefined && currentUserProfile[field] !== null && currentUserProfile[field] !== "") {
            sessionData[field] = currentUserProfile[field];
        }
    });

    await setDoc(newSessionRef, sessionData);
    return newSessionRef;
}

async function stopAttendanceSession(activeSession) {
    await updateDoc(activeSession, {
        status: "stopped",
        endedAt: serverTimestamp()
    });
}

// ==========================================
// ERROR MESSAGES
// ==========================================

function getNfcErrorMessage(error) {

    if (error.name === "NotAllowedError") {
        return "NFC permission was denied. Allow NFC access in Chrome.";
    }

    if (error.name === "NotSupportedError") {
        return "NFC is not supported on this device.";
    }

    if (error.name === "NotReadableError") {
        return "NFC is busy or unavailable. Close other NFC apps and retry.";
    }

    if (error.name === "AbortError") {
        return "NFC scanning was cancelled.";
    }

    return error.message ||
        "Check your phone's NFC settings and try again.";
}

function getFriendlyError(error) {

    if (error.code === "permission-denied") {
        return "Firestore permission denied. Check your Firestore security rules.";
    }

    if (error.code === "failed-precondition") {
        return "Firestore query requires an index or another database condition.";
    }

    return error.message || "Please try scanning again.";
}

// ==========================================
// LOGOUT
// ==========================================

logoutButton.addEventListener("click", async function () {
    const confirmed = await window.showConfirm({
        title: "Log out of Tap2Present?",
        message: "Stop the scanner and leave the faculty portal?",
        confirmText: "Log out"
    });

    if (!confirmed) return;

    stopScanner();

    try {
        await signOut(auth);
        window.location.href = "faculty-login.html";

    } catch (error) {
        console.error("Logout error:", error);
        window.showToast("Unable to logout. Please try again.", "error", "Logout failed");
    }
});
