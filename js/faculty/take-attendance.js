
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
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// HTML elements
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

// Variables
let currentUser = null;
let ndef = null;
let scanning = false;
let processingCard = false;
let recentScans = [];
let scanAbortController = null;

// Local date and time
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

// Authentication
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

        if (
            userData.role !== "faculty" &&
            userData.role !== "admin"
        ) {
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

        const name = userData.name || "Faculty";

        facultyName.textContent = name;
        facultyInitial.textContent = name.charAt(0).toUpperCase();

    } catch (error) {
        console.error("Authentication error:", error);
        showResult("Account verification failed", error.message, "error");
    }
});

// Start NFC scanner
startButton.addEventListener("click", async function () {
    if (!currentUser) {
        showResult("Not logged in", "Please log in again.", "error");
        return;
    }

    if (!subjectInput.value.trim()) {
        showResult("Subject required", "Enter the subject first.", "error");
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

        // Register events before starting scan
        ndef.addEventListener("reading", handleNfcReading);

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

        scanning = true;

        startButton.disabled = true;
        stopButton.disabled = false;

        readerIndicator.textContent = "Scanning";
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

        showResult(
            "Unable to start NFC",
            getNfcErrorMessage(error),
            "error"
        );
    }
});

// Process NFC reading
async function handleNfcReading(event) {
    if (processingCard || !scanning) {
        return;
    }

    processingCard = true;

    try {
        console.log("NFC event received:", event);
        console.log("NDEF records:", event.message.records);

        const studentCode = readStudentCode(event.message);

        if (!studentCode) {
            showResult(
                "Invalid NFC card",
                "The card was read, but its text could not be recognized. Check the browser console for record details.",
                "error"
            );
            return;
        }

        console.log("Extracted student ID:", studentCode);

        await markStudentAttendance(studentCode);

    } catch (error) {
        console.error("Card processing error:", error);

        showResult(
            "Attendance failed",
            error.message || "Please try again.",
            "error"
        );

    } finally {
        setTimeout(function () {
            processingCard = false;
        }, 1500);
    }
}

// Convert NFC record data into a byte array
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

// Extract student ID from NFC text record
function readStudentCode(message) {
    if (!message || !message.records) {
        console.error("No NDEF message or records found.");
        return null;
    }

    for (const record of message.records) {
        console.log("Checking NFC record:", record.recordType);

        if (record.recordType !== "text") {
            continue;
        }

        const bytes = getRecordBytes(record.data);

        if (!bytes || bytes.length < 2) {
            console.warn("NFC text record has no usable data.");
            continue;
        }

        try {
            const statusByte = bytes[0];

            // Bit 7 indicates UTF-16; otherwise UTF-8.
            const isUTF16 = (statusByte & 0x80) !== 0;

            // Lower 6 bits contain the language-code length.
            const languageLength = statusByte & 0x3F;

            const textStart = 1 + languageLength;

            if (textStart > bytes.length) {
                console.warn("Invalid NDEF language prefix.");
                continue;
            }

            const textBytes = bytes.slice(textStart);

            const decoder = new TextDecoder(
                isUTF16 ? "utf-16" : "utf-8"
            );

            let decodedText = decoder.decode(textBytes);

            // Clean BOM, null characters and whitespace.
            decodedText = decodedText
                .replace(/^\uFEFF/, "")
                .replace(/\0/g, "")
                .trim();

            console.log("Decoded NFC text:", JSON.stringify(decodedText));

            // Remove invisible characters and normalize spaces.
            decodedText = decodedText
                .replace(/[\u200B-\u200D\u2060]/g, "")
                .trim();

            const match = decodedText.match(/^TAP2P\s*:\s*([A-Za-z0-9_-]{1,40})$/i);

            if (match) {
                return match[1].trim().toUpperCase();
            }

        } catch (error) {
            console.error("NFC text decoding error:", error);
        }
    }

    return null;
}

// Find student and save attendance
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

    const attendanceRef = doc(db, "attendance", attendanceId);

    // Prevent duplicate attendance
    const result = await runTransaction(db, async function (transaction) {
        const existingRecord = await transaction.get(attendanceRef);

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
    });

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

    addScanToTable({
        studentCode: studentCode,
        studentName: student.name || "Student",
        time: time
    });
}

// Generate attendance document ID
function createAttendanceId(studentUid, date, subject) {
    const safeSubject = subject
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    return `${studentUid}_${date}_${safeSubject}`;
}

// Display result
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

    content.appendChild(heading);
    content.appendChild(paragraph);

    scanResult.appendChild(icon);
    scanResult.appendChild(content);
}

// Add successful scan to table
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

// Stop NFC scanner
stopButton.addEventListener("click", stopScanner);

function stopScanner() {
    if (scanAbortController) {
        scanAbortController.abort();
        scanAbortController = null;
    }

    scanning = false;
    ndef = null;

    startButton.disabled = false;
    stopButton.disabled = true;

    readerIndicator.textContent = "Not Started";
    readerIndicator.className = "reader-indicator";

    scannerTitle.textContent = "Scanner stopped";
    scannerDescription.textContent =
        "Start the scanner when you are ready.";

    nfcAnimation.classList.remove("scanning");
}

// NFC error messages
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

// Logout
logoutButton.addEventListener("click", async function () {
    stopScanner();

    try {
        await signOut(auth);
        window.location.href = "faculty-login.html";

    } catch (error) {
        console.error("Logout error:", error);
        alert("Unable to logout. Please try again.");
    }
});
