
import { auth, db } from "../../firebase-config.js";

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
    onSnapshot,
    addDoc,
    updateDoc,
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
const nfcAnimation = document.getElementById("nfcAnimation");

const subjectInput = document.getElementById("subjectInput");
const subjectCodeInput = document.getElementById("subjectCodeInput");
const classInput = document.getElementById("classInput");
const semesterInput = document.getElementById("semesterInput");
const divisionInput = document.getElementById("divisionInput");
const dateDisplay = document.getElementById("dateDisplay");

const startSessionButton = document.getElementById("startSessionButton");
const endSessionButton = document.getElementById("endSessionButton");
const sessionMessage = document.getElementById("sessionMessage");

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
let nfcAbortController = null;
let activeSession = null;
let unsubscribeActiveSession = null;
let unsubscribeTodayScans = null;

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

function getTimestamp(value) {
    if (value?.toMillis) return value.toMillis();
    const timestamp = new Date(value || 0).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

dateDisplay.value = getLocalDate();

// ---------------------------------------------
// UI HELPERS
// ---------------------------------------------

function updateScannerUI(status, title, description) {
    readerIndicator.textContent = status;
    scannerTitle.textContent = title;
    scannerDescription.textContent = description;

    const isScanning = status === "Scanning";
    readerIndicator.classList.toggle("active", isScanning);
    readerIndicator.classList.toggle("error", status === "Error" || status === "Unavailable" || status === "Unsupported");
    nfcAnimation?.classList.toggle("scanning", isScanning);
}

function showResult(title, message, type = "info") {
    scanResult.className = `scan-result ${type}`;

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

function loadTodaysScans() {
    const date = getLocalDate();
    const todaysQuery = query(
        collection(db, "attendance"),
        where("date", "==", date)
    );

    unsubscribeTodayScans = onSnapshot(
        todaysQuery,
        snapshot => {
            const records = snapshot.docs
                .map(attendanceDocument => attendanceDocument.data())
                .filter(record => activeSession
                    ? record.sessionId === activeSession.id
                    : true);

            scanTableBody.innerHTML = "";
            scannedStudents.clear();

            if (!records.length) {
                scanTableBody.innerHTML =
                    '<tr><td colspan="4" class="empty-table">No attendance marked yet.</td></tr>';
                updateScanCount();
                return;
            }

            records
                .sort((left, right) => getTimestamp(right.scannedAt) - getTimestamp(left.scannedAt))
                .forEach(record => {
                    scannedStudents.add(record.studentId);
                    addStudentToTable(
                        { name: record.studentName || "Student" },
                        record.studentCode || record.studentId,
                        record.time
                    );
                });
            updateScanCount();
        },
        error => console.error("Today's attendance listener error:", error)
    );
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

        loadTodaysScans();
        listenForActiveSession();

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
// ATTENDANCE SESSION MANAGEMENT
// ---------------------------------------------

function listenForActiveSession() {
    if (!currentFaculty) return;

    const sessionsQuery = query(
        collection(db, "sessions"),
        where("facultyId", "==", currentFaculty.uid)
    );

    unsubscribeActiveSession = onSnapshot(
        sessionsQuery,
        snapshot => {
            const active = snapshot.docs
                .map(sessionDocument => ({
                    id: sessionDocument.id,
                    ...sessionDocument.data()
                }))
                .find(sessionData => sessionData.status === "active");

            activeSession = active || null;
            endSessionButton.disabled = !activeSession;
            startSessionButton.disabled = Boolean(activeSession);

            if (activeSession) {
                sessionMessage.textContent =
                    `Active session: ${activeSession.subjectName || activeSession.subject} (${activeSession.id})`;
                subjectInput.value = activeSession.subjectName || activeSession.subject || subjectInput.value;
                subjectCodeInput.value = activeSession.subjectCode || "";
                classInput.value = activeSession.className || activeSession.classId || "";
                semesterInput.value = activeSession.semester ?? "";
                divisionInput.value = activeSession.division || "";

                subjectInput.disabled = true;
                subjectCodeInput.disabled = true;
                classInput.disabled = true;
                semesterInput.disabled = true;
                divisionInput.disabled = true;
            } else {
                sessionMessage.textContent = "Start a session before using the NFC scanner.";
                subjectInput.disabled = false;
                subjectCodeInput.disabled = false;
                classInput.disabled = false;
                semesterInput.disabled = false;
                divisionInput.disabled = false;
            }
        },
        error => {
            console.error("Active session listener error:", error);
            sessionMessage.textContent = "Unable to load the active session.";
        }
    );
}

async function startAttendanceSession() {
    console.log("Button click detected: Start Session");

    if (!currentFaculty) {
        showToast("Faculty account is not ready.", "error");
        return;
    }

    const subject = subjectInput.value.trim();
    const subjectCode = subjectCodeInput.value.trim();
    const className = classInput.value.trim();
    const semester = Number(semesterInput.value);
    const division = divisionInput.value.trim();

    if (!subject || !className || !semester || !division) {
        showToast("Enter subject, class, semester and division.", "warning");
        return;
    }

    startSessionButton.disabled = true;

    try {
        const duplicateQuery = query(
            collection(db, "sessions"),
            where("status", "==", "active")
        );
        const snapshot = await getDocs(duplicateQuery);
        const duplicate = snapshot.docs
            .map(sessionDocument => ({
                id: sessionDocument.id,
                ...sessionDocument.data()
            }))
            .find(sessionData =>
                sessionData.facultyId === currentFaculty.uid &&
                String(sessionData.subjectName || sessionData.subject || "").toLowerCase() === subject.toLowerCase() &&
                String(sessionData.className || sessionData.classId || "").toLowerCase() === className.toLowerCase() &&
                String(sessionData.semester || "") === String(semester) &&
                String(sessionData.division || "").toLowerCase() === division.toLowerCase()
            );

        if (duplicate) {
            activeSession = duplicate;
            sessionMessage.textContent =
                `An active session already exists: ${duplicate.id}`;
            showToast("This session is already active.", "warning");
            endSessionButton.disabled = false;
            return;
        }

        const now = serverTimestamp();
        const sessionReference = await addDoc(collection(db, "sessions"), {
            sessionId: "",
            facultyId: currentFaculty.uid,
            facultyName: currentFaculty.name,
            subject: subject,
            subjectName: subject,
            subjectCode,
            class: className,
            className,
            classId: className,
            semester,
            division,
            date: getLocalDate(),
            startTime: now,
            startedAt: now,
            status: "active",
            endTime: null,
            endedAt: null
        });

        await updateDoc(sessionReference, { sessionId: sessionReference.id });
        activeSession = { id: sessionReference.id, sessionId: sessionReference.id };

        sessionMessage.textContent =
            `Active session started: ${subject}`;
        endSessionButton.disabled = false;
        startSessionButton.disabled = true;
        showToast("Attendance session started.", "success");
        console.log("Active attendance session created:", sessionReference.id);
    } catch (error) {
        console.error("Start attendance session failed:", error);
        startSessionButton.disabled = false;
        sessionMessage.textContent =
            error.message || "Unable to start the attendance session.";
        showToast("Unable to start the attendance session.", "error");
    }
}

async function endAttendanceSession() {
    console.log("Button click detected: End Session");

    if (!activeSession) {
        showToast("There is no active session.", "warning");
        return;
    }

    endSessionButton.disabled = true;

    try {
        const endedSessionId = activeSession.id;
        await updateDoc(doc(db, "sessions", endedSessionId), {
            status: "completed",
            endTime: serverTimestamp(),
            endedAt: serverTimestamp()
        });

        activeSession = null;
        startSessionButton.disabled = false;
        sessionMessage.textContent = "Session ended. You can start a new session.";
        showToast("Attendance session ended.", "success");
        console.log("Attendance session ended:", endedSessionId);

        if (scannerActive) await stopScanner();
    } catch (error) {
        console.error("End attendance session failed:", error);
        endSessionButton.disabled = false;
        showToast("Unable to end the attendance session.", "error");
    }
}

// ---------------------------------------------
// NFC SUPPORT CHECK
// ---------------------------------------------

function checkNFCSupport() {
    if (!window.isSecureContext) {
        console.error("NFC support detected: false (secure context required)");
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
        console.error("NFC support detected: false (NDEFReader unavailable)");
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

    console.log("NFC support detected: true");
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
    console.log("Button click detected: Start NFC Scanner");

    if (scannerActive) return;

    if (!currentFaculty) {
        showToast("Faculty account is not ready.", "error");
        return;
    }

    if (!activeSession) {
        showToast("Start an attendance session before scanning.", "warning");
        showResult(
            "No active session",
            "Start an attendance session before scanning NFC cards.",
            "error"
        );
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
        nfcAbortController = new AbortController();

        // Attach reading events before requesting scan.
        nfcReader.addEventListener("reading", handleNFCReading);

        nfcReader.addEventListener("readingerror", handleNFCReadingError);

        // IMPORTANT:
        // scan() is called directly from the Start button interaction.
        await nfcReader.scan({ signal: nfcAbortController.signal });

        scannerActive = true;
        console.log("NFC scanning started");

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
        if (error.name === "AbortError" && !scannerActive) {
            console.log("NFC scanning stopped");
            return;
        }

        scannerActive = false;
        nfcAbortController = null;

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
        console.error("Permission or scan error:", error);
    }
}

// ---------------------------------------------
// STOP NFC SCANNER
// ---------------------------------------------

async function stopScanner() {
    console.log("Button click detected: Stop Scanner");

    try {
        if (nfcReader) {
            nfcReader.removeEventListener("reading", handleNFCReading);
            nfcReader.removeEventListener("readingerror", handleNFCReadingError);
        }
        if (nfcAbortController) {
            nfcAbortController.abort();
        }
    } catch (error) {
        console.warn("NFC stop warning:", error);
    }

    nfcReader = null;
    nfcAbortController = null;
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
    console.log("NFC tag detected");
    console.log("Raw NFC data:", event.message);
    console.log("NFC serial number:", event.serialNumber || "Not available");

    try {
        const studentCode = readStudentCode(event.message, event.serialNumber);

        if (!studentCode) {
            console.warn("Student ID extracted: none");
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
        console.error("Firestore permission or scan error:", {
            code: error.code || "unknown",
            message: error.message
        });

        showResult(
            "Scan failed",
            error.code
                ? `${error.code}: ${error.message}`
                : (error.message || "Something went wrong while processing this card."),
            "error"
        );

    } finally {
        processingCard = false;
        if (scannerActive) {
            startButton.disabled = true;
            stopButton.disabled = false;
        }
    }
}

function handleNFCReadingError() {
    console.error("Permission or scan error: unable to read NFC card");
    showResult(
        "Unable to read card",
        "Keep the NFC card close to the phone and try again.",
        "error"
    );
}

// ---------------------------------------------
// EXTRACT STUDENT ID FROM NDEF MESSAGE
// ---------------------------------------------

function readStudentCode(message, serialNumber) {
    for (const record of message.records) {
        try {
            let text = "";

            if (record.recordType === "text") {
                const data = new Uint8Array(record.data);
                if (data.length === 0) continue;

                const status = data[0];
                const languageCodeLength = status & 0x3f;
                text = new TextDecoder(status & 0x80 ? "utf-16" : "utf-8")
                    .decode(data.slice(1 + languageCodeLength));

            } else if (record.recordType === "mime") {
                const decoder = new TextDecoder();
                text = decoder.decode(record.data);

            } else if (record.recordType === "url") {
                const decoder = new TextDecoder();
                text = decoder.decode(record.data);
            }

            text = text.trim();
            console.log("NDEF record decoded:", text);
            console.log("Raw NFC text record:", text);

            const match = text.match(/^TAP2P:\s*([A-Z]+\d+)\s*$/i)
                || text.match(/TAP2P:\s*([A-Z]+\d+)/i);

            if (match) {
                const studentCode = match[1].replace(/\s+/g, "").toUpperCase();
                console.log("Student ID extracted:", studentCode);
                return studentCode;
            }

        } catch (error) {
            console.warn("Unable to decode NFC record:", error);
        }
    }

    if (serialNumber) {
        const normalizedSerial = String(serialNumber).replace(/[^A-Z0-9]/gi, "").toUpperCase();
        if (normalizedSerial) {
            console.log("Student ID extracted from NFC card serial:", normalizedSerial);
            return normalizedSerial;
        }
    }

    return null;
}

// ---------------------------------------------
// FIND STUDENT IN FIRESTORE
// ---------------------------------------------

async function findStudent(studentCode) {
    const normalizedCode = String(studentCode).trim().replace(/\s+/g, "").toUpperCase();
    console.log("Firestore collection searched: users");
    console.log("NFC student ID lookup:", normalizedCode);

    try {
        const studentIdQuery = query(
            collection(db, "users"),
            where("studentId", "==", normalizedCode)
        );
        let snapshot = await getDocs(studentIdQuery);
        console.log("Number of matching student documents:", snapshot.size);

        // Compatibility fallback for profiles that may contain whitespace or
        // lowercase student IDs. The primary lookup above remains the exact query.
        if (snapshot.empty) {
            const allUsers = await getDocs(collection(db, "users"));
            snapshot = allUsers;
            snapshot = snapshot.docs.filter((studentDocument) => {
                const data = studentDocument.data();
                const storedId = String(data.studentId || "")
                    .trim()
                    .replace(/\s+/g, "")
                    .toUpperCase();
                return storedId === normalizedCode;
            });
            console.log("Number of normalized matching student documents:", snapshot.length);
        } else {
            snapshot = snapshot.docs;
        }

        if (!snapshot.length) {
            throw new Error(`Student ID ${normalizedCode} was not found in users.`);
        }

        const studentDocument = snapshot.find((documentSnapshot) => {
            const data = documentSnapshot.data();
            return data.role === "student";
        }) || snapshot[0];

        const data = studentDocument.data();
        console.log("Student academic details:", {
            name: data.name,
            studentId: data.studentId,
            className: data.className || data.classId || data.department || null,
            semester: data.semester ?? null,
            division: data.division || null
        });

        if (data.role !== "student") {
            throw new Error(`The matching document for ${normalizedCode} is not a student account.`);
        }
        if (String(data.status).toLowerCase() !== "active") {
            throw new Error(`Student ${normalizedCode} is inactive.`);
        }

        return {
            uid: studentDocument.id,
            ...data
        };
    } catch (error) {
        console.error("Firestore student lookup error:", {
            code: error.code || "unknown",
            message: error.message,
            studentId: normalizedCode
        });
        throw error;
    }
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

    if (!activeSession) {
        throw new Error("No valid active attendance session.");
    }

    showResult(
        "Verifying student",
        `Checking student ID ${studentCode}...`,
        "info"
    );
    startButton.disabled = true;
    stopButton.disabled = true;

    const student = await findStudent(studentCode);

    if (student.status !== "active") {
        startButton.disabled = false;
        stopButton.disabled = false;
        throw new Error("This student account is inactive.");
    }

    if (scannedStudents.has(student.uid)) {
        startButton.disabled = false;
        stopButton.disabled = false;
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

    const attendanceId = `${activeSession.id}_${student.uid}`;
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
            subjectCode: subjectCodeInput.value.trim(),
            date: date,
            time: getLocalTime(),
            status: "present",
            attendanceStatus: "present",
            sessionId: activeSession.id,
            scannedBy: currentFaculty.uid,
            facultyId: currentFaculty.uid,
            scannedAt: serverTimestamp(),
            createdAt: serverTimestamp()
        });
    });

    scannedStudents.add(student.uid);
    startButton.disabled = false;
    stopButton.disabled = false;

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
    console.log("Attendance successfully recorded:", {
        studentId: studentCode,
        uid: student.uid,
        subject,
        date
    });
}

// ---------------------------------------------
// ADD STUDENT TO TODAY'S TABLE
// ---------------------------------------------

function addStudentToTable(student, studentCode, scannedTime) {
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
    timeCell.textContent = scannedTime || getLocalTime();

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
startSessionButton?.addEventListener("click", startAttendanceSession);
endSessionButton?.addEventListener("click", endAttendanceSession);

window.addEventListener("pagehide", () => {
    unsubscribeActiveSession?.();
    unsubscribeTodayScans?.();
});

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
