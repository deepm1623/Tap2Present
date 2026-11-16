
import { auth, db } from "../firebase-config.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// ---------------------------------------------
// DOM ELEMENTS
// ---------------------------------------------

const startButton = document.getElementById("startScannerButton");
const stopButton = document.getElementById("stopScannerButton");

const readerIndicator = document.getElementById("readerIndicator");
const scannerTitle = document.getElementById("scannerTitle");
const scannerDescription = document.getElementById("scannerDescription");

const subjectInput = document.getElementById("subjectInput");
const dateDisplay = document.getElementById("dateDisplay");

const scanResult = document.getElementById("scanResult");
const scanTableBody = document.getElementById("scanTableBody");
const scanCount = document.getElementById("scanCount");

const facultyName = document.getElementById("facultyName");
const facultyInitial = document.getElementById("facultyInitial");
const logoutButton = document.getElementById("logoutButton");

// ---------------------------------------------
// STATE
// ---------------------------------------------

let currentFaculty = null;
let nfcReader = null;
let scannerActive = false;
let processingCard = false;

const scannedStudents = new Set();

// ---------------------------------------------
// DATE HELPERS
// ---------------------------------------------

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

// ---------------------------------------------
// UI HELPERS
// ---------------------------------------------

function updateScannerUI(status, title, description) {
    readerIndicator.textContent = status;
    scannerTitle.textContent = title;
    scannerDescription.textContent = description;
}

function showResult(title, message, type = "info") {
    scanResult.className = `scan-result ${type}-result`;

    scanResult.innerHTML = "";

    const icon = document.createElement("div");
    icon.className = "result-icon";
    icon.textContent =
        type === "success" ? "✓" :
        type === "error" ? "!" : "NFC";

    const content = document.createElement("div");

    const heading = document.createElement("h3");
    heading.textContent = title;

    const paragraph = document.createElement("p");
    paragraph.textContent = message;

    content.append(heading, paragraph);
    scanResult.append(icon, content);
}

function showToast(message, type = "info") {
    if (typeof window.showToast === "function") {
        window.showToast(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
}

function updateScanCount() {
    scanCount.textContent = `${scannedStudents.size} scanned`;
}

// ---------------------------------------------
// AUTHENTICATION
// ---------------------------------------------

function waitForAuthentication() {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
        });
    });
}

async function initializeFaculty() {
    try {
        const user = await waitForAuthentication();

        if (!user) {
            window.location.href = "../index.html";
            return;
        }

        const userRef = doc(db, "users", user.uid);
        const userSnapshot = await getDoc(userRef);

        if (!userSnapshot.exists()) {
            throw new Error("Faculty profile was not found.");
        }

        const profile = userSnapshot.data();

        if (profile.role !== "faculty" && profile.role !== "admin") {
            window.location.href = "../index.html";
            return;
        }

        if (profile.status !== "active") {
            throw new Error("Your account is inactive. Contact the administrator.");
        }

        currentFaculty = {
            uid: user.uid,
            name: profile.name || user.displayName || "Faculty"
        };

        facultyName.textContent = currentFaculty.name;
        facultyInitial.textContent =
            currentFaculty.name.charAt(0).toUpperCase();

    } catch (error) {
        console.error("Faculty initialization error:", error);

        showResult(
            "Unable to load faculty account",
            error.message || "Please log in again.",
            "error"
        );
    }
}

// ---------------------------------------------
// NFC SUPPORT CHECK
// ---------------------------------------------

function checkNFCSupport() {
    if (!window.isSecureContext) {
        showResult(
            "Secure connection required",
            "Open this page using your HTTPS Vercel URL. NFC does not work on an ordinary HTTP connection.",
            "error"
        );

        updateScannerUI(
            "Unavailable",
            "HTTPS required",
            "Open the website using its secure HTTPS address."
        );

        startButton.disabled = true;
        return false;
    }

    if (!("NDEFReader" in window)) {
        showResult(
            "Web NFC not supported",
            "Use a compatible Android phone with NFC and a supported browser such as Chrome.",
            "error"
        );

        updateScannerUI(
            "Unsupported",
            "NFC not supported",
            "Try Chrome on an NFC-enabled Android phone."
        );

        startButton.disabled = true;
        return false;
    }

    return true;
}

// ---------------------------------------------
// NFC ERROR HANDLING
// ---------------------------------------------

function getNFCErrorMessage(error) {
    console.error("NFC error:", error);

    switch (error.name) {
        case "NotAllowedError":
            return "NFC permission was denied. Allow NFC access in your browser and check that NFC is enabled on your phone.";

        case "NotSupportedError":
            return "This device or browser does not support Web NFC.";

        case "NotReadableError":
            return "NFC is unavailable. Check that NFC is enabled and that another application is not using the NFC reader.";

        case "AbortError":
            return "The NFC scanning operation was interrupted.";

        case "SecurityError":
            return "The browser blocked NFC access. Open the website through HTTPS and check browser permissions.";

        case "InvalidStateError":
            return "The NFC reader is already active or is in an invalid state.";

        default:
            return error.message || "Unable to start NFC. Check your phone settings and browser permissions.";
    }
}

// ---------------------------------------------
// START NFC SCANNER
// ---------------------------------------------

async function startScanner() {
    if (scannerActive) return;

    if (!currentFaculty) {
        showToast("Faculty account is not ready.", "error");
        return;
    }

    if (!subjectInput.value.trim()) {
        showToast("Please enter a subject first.", "warning");
        subjectInput.focus();
        return;
    }

    if (!checkNFCSupport()) return;

    try {
        // Create reader only after the user clicks the button.
        nfcReader = new NDEFReader();

        // Attach reading events before requesting scan.
        nfcReader.addEventListener("reading", handleNFCReading);

        nfcReader.addEventListener("readingerror", () => {
            showResult(
                "Unable to read card",
                "Keep the NFC card close to the phone and try again.",
                "error"
            );
        });

        // IMPORTANT:
        // scan() is called directly from the Start button interaction.
        await nfcReader.scan();

        scannerActive = true;

        startButton.disabled = true;
        stopButton.disabled = false;

        updateScannerUI(
            "Scanning",
            "Scanner is active",
            "Bring a student's NFC card close to your phone."
        );

        showResult(
            "Scanner ready",
            "NFC is active. Tap a student card against your phone.",
            "success"
        );

        showToast("NFC scanner started successfully.", "success");

    } catch (error) {
        scannerActive = false;

        startButton.disabled = false;
        stopButton.disabled = true;

        const message = getNFCErrorMessage(error);

        updateScannerUI(
            "Error",
            "Unable to start NFC",
            message
        );

        showResult(
            "Unable to start NFC",
            message,
            "error"
        );

        console.error("Scanner startup failed:", error);
    }
}

// ---------------------------------------------
// STOP NFC SCANNER
// ---------------------------------------------

async function stopScanner() {
    try {
        if (nfcReader) {
            nfcReader.removeEventListener("reading", handleNFCReading);

            if (typeof nfcReader.abort === "function") {
                await nfcReader.abort();
            }
        }
    } catch (error) {
        console.warn("NFC stop warning:", error);
    }

    nfcReader = null;
    scannerActive = false;
    processingCard = false;

    startButton.disabled = false;
    stopButton.disabled = true;

    updateScannerUI(
        "Not Started",
        "Ready to scan",
        "Start the scanner and bring a student's NFC card close to your phone."
    );

    showToast("NFC scanner stopped.", "info");
}

// ---------------------------------------------
// READ NFC CARD
// ---------------------------------------------

async function handleNFCReading(event) {
    if (!scannerActive || processingCard) return;

    processingCard = true;

    try {
        const studentCode = readStudentCode(event.message);

        if (!studentCode) {
            showResult(
                "Invalid NFC card",
                "This card does not contain a valid Tap2Present student ID.",
                "error"
            );

            return;
        }

        await markStudentAttendance(studentCode);

    } catch (error) {
        console.error("Card reading error:", error);

        showResult(
            "Scan failed",
            error.message || "Something went wrong while processing this card.",
            "error"
        );

    } finally {
        processingCard = false;
    }
}

// ---------------------------------------------
// EXTRACT STUDENT ID FROM NDEF MESSAGE
// ---------------------------------------------

function readStudentCode(message) {
    for (const record of message.records) {
        try {
            let text = "";

            if (record.recordType === "text") {
                const decoder = new TextDecoder(
                    record.encoding || "utf-8"
                );

                text = decoder.decode(record.data);

            } else if (record.recordType === "mime") {
                const decoder = new TextDecoder();
                text = decoder.decode(record.data);

            } else if (record.recordType === "url") {
                const decoder = new TextDecoder();
                text = decoder.decode(record.data);
            }

            text = text.trim();

            const match = text.match(/TAP2P:\s*([A-Z0-9_-]+)/i);

            if (match) {
                return match[1].toUpperCase();
            }

        } catch (error) {
            console.warn("Unable to decode NFC record:", error);
        }
    }

    return null;
}

// ---------------------------------------------
// FIND STUDENT IN FIRESTORE
// ---------------------------------------------

async function findStudent(studentCode) {
    const studentsQuery = query(
        collection(db, "users"),
        where("studentId", "==", studentCode),
        where("role", "==", "student")
    );

    const snapshot = await getDocs(studentsQuery);

    if (snapshot.empty) {
        throw new Error("Student ID was not found in the system.");
    }

    const studentDocument = snapshot.docs[0];

    return {
        uid: studentDocument.id,
        ...studentDocument.data()
    };
}

// ---------------------------------------------
// MARK ATTENDANCE
// ---------------------------------------------

async function markStudentAttendance(studentCode) {
    const subject = subjectInput.value.trim();
    const date = getLocalDate();

    if (!subject) {
        throw new Error("Please enter a subject.");
    }

    showResult(
        "Verifying student",
        `Checking student ID ${studentCode}...`,
        "info"
    );

    const student = await findStudent(studentCode);

    if (student.status !== "active") {
        throw new Error("This student account is inactive.");
    }

    if (scannedStudents.has(student.uid)) {
        showResult(
            "Already scanned",
            `${student.name} has already been scanned during this session.`,
            "error"
        );

        return;
    }

    const subjectKey = subject
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    const attendanceId = `${student.uid}_${date}_${subjectKey}`;
    const attendanceRef = doc(db, "attendance", attendanceId);

    await runTransaction(db, async (transaction) => {
        const existingAttendance = await transaction.get(attendanceRef);

        if (existingAttendance.exists()) {
            throw new Error(
                "Attendance has already been recorded for this student, subject and date."
            );
        }

        transaction.set(attendanceRef, {
            studentId: student.uid,
            studentCode: studentCode,
            studentName: student.name || "Student",
            subject: subject,
            date: date,
            time: getLocalTime(),
            status: "present",
            scannedBy: currentFaculty.uid,
            createdAt: serverTimestamp()
        });
    });

    scannedStudents.add(student.uid);

    updateScanCount();
    addStudentToTable(student, studentCode);

    showResult(
        "Attendance marked successfully",
        `${student.name || "Student"} (${studentCode}) is marked PRESENT for ${subject}.`,
        "success"
    );

    showToast(
        `${student.name || studentCode} marked present.`,
        "success"
    );
}

// ---------------------------------------------
// ADD STUDENT TO TODAY'S TABLE
// ---------------------------------------------

function addStudentToTable(student, studentCode) {
    const emptyRow = scanTableBody.querySelector(".empty-table");

    if (emptyRow) {
        scanTableBody.innerHTML = "";
    }

    const row = document.createElement("tr");

    const idCell = document.createElement("td");
    idCell.textContent = studentCode;

    const nameCell = document.createElement("td");
    nameCell.textContent = student.name || "Student";

    const timeCell = document.createElement("td");
    timeCell.textContent = getLocalTime();

    const statusCell = document.createElement("td");
    statusCell.textContent = "Present";
    statusCell.className = "present-status";

    row.append(
        idCell,
        nameCell,
        timeCell,
        statusCell
    );

    scanTableBody.prepend(row);
}

// ---------------------------------------------
// LOGOUT
// ---------------------------------------------

logoutButton?.addEventListener("click", async () => {
    const confirmed = typeof window.showConfirm === "function"
        ? await window.showConfirm({
            title: "Log out of Tap2Present?",
            message: "Stop the scanner and leave the faculty portal?",
            confirmText: "Log out",
            danger: true
        })
        : window.confirm("Are you sure you want to log out?");

    if (!confirmed) return;

    await stopScanner();
    await signOut(auth);

    window.location.href = "../index.html";
});

// ---------------------------------------------
// BUTTON EVENTS
// ---------------------------------------------

startButton.addEventListener("click", startScanner);
stopButton.addEventListener("click", stopScanner);

// ---------------------------------------------
// INITIALIZE PAGE
// ---------------------------------------------

startButton.disabled = true;
stopButton.disabled = true;

initializeFaculty().then(() => {
    if (currentFaculty) {
        startButton.disabled = !checkNFCSupport();
    }
});
