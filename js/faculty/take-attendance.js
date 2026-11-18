
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
    setDoc,
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
let lastObservedSessionId = undefined;
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

function clearLatestScanResult() {
    scanResult.className = "scan-result empty-result";
    scanResult.innerHTML = "";

    const icon = document.createElement("div");
    icon.className = "result-icon";
    icon.textContent = "NFC";

    const content = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = "No card scanned yet";
    const paragraph = document.createElement("p");
    paragraph.textContent = "Student details will appear here.";

    content.append(heading, paragraph);
    scanResult.append(icon, content);
}

function getSessionId(session) {
    if (!session) return null;
    return session.sessionId || session.id || null;
}

function buildAttendanceDocumentId(sessionId, studentUid) {
    return `${sessionId}_${studentUid}`;
}

function renderEmptyScanTable() {
    scanTableBody.innerHTML =
        '<tr><td colspan="5" class="empty-table">No attendance marked yet.</td></tr>';
    scannedStudents.clear();
    updateScanCount();
}

function createScanRow(record) {
    const row = document.createElement("tr");

    const idCell = document.createElement("td");
    idCell.textContent = record.studentCode || record.studentId || "Unknown";

    const nameCell = document.createElement("td");
    nameCell.textContent = record.studentName || record.name || "Student";

    const subjectCell = document.createElement("td");
    subjectCell.textContent = record.subject || activeSession?.subjectName || activeSession?.subject || "-";

    const timeCell = document.createElement("td");
    timeCell.textContent = record.time || getLocalTime();

    const statusCell = document.createElement("td");
    statusCell.textContent = "Present";
    statusCell.className = "present-status";

    row.append(idCell, nameCell, subjectCell, timeCell, statusCell);
    return row;
}

function setSessionFieldsLocked(locked) {
    subjectInput.disabled = locked;
    subjectCodeInput.disabled = locked;
    classInput.disabled = locked;
    semesterInput.disabled = locked;
    divisionInput.disabled = locked;
}

function fillSessionFields(session) {
    if (!session) return;

    subjectInput.value = session.subjectName || session.subject || "";
    subjectCodeInput.value = session.subjectCode || "";
    classInput.value = session.className || session.classId || session.class || "";
    semesterInput.value = session.semester ?? "";
    divisionInput.value = session.division || "";
    if (session.date) {
        dateDisplay.value = session.date;
    }
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

function listenToSessionAttendance(sessionId) {
    unsubscribeTodayScans?.();
    unsubscribeTodayScans = null;
    renderEmptyScanTable();

    if (!sessionId) {
        return;
    }

    const sessionAttendanceQuery = query(
        collection(db, "attendance"),
        where("sessionId", "==", sessionId)
    );

    unsubscribeTodayScans = onSnapshot(
        sessionAttendanceQuery,
        snapshot => {
            const records = snapshot.docs.map(attendanceDocument => ({
                id: attendanceDocument.id,
                ...attendanceDocument.data()
            }));

            scanTableBody.innerHTML = "";
            scannedStudents.clear();

            if (!records.length) {
                renderEmptyScanTable();
                return;
            }

            records
                .sort((left, right) => getTimestamp(right.scannedAt) - getTimestamp(left.scannedAt))
                .forEach(record => {
                    if (record.studentId) scannedStudents.add(record.studentId);
                    scanTableBody.appendChild(createScanRow(record));
                });
            updateScanCount();
        },
        error => console.error("Session attendance listener error:", error)
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

            applyActiveSession(active || null);
        },
        error => {
            console.error("Active session listener error:", error);
            sessionMessage.textContent = "Unable to load the active session.";
        }
    );
}

function applyActiveSession(session) {
    const sessionId = getSessionId(session);
    const sessionChanged = sessionId !== lastObservedSessionId;

    activeSession = session;
    endSessionButton.disabled = !activeSession;
    startSessionButton.disabled = Boolean(activeSession);
    setSessionFieldsLocked(Boolean(activeSession));

    if (activeSession) {
        fillSessionFields(activeSession);
        sessionMessage.textContent =
            `Active session: ${activeSession.subjectName || activeSession.subject} (${sessionId})`;
    } else {
        sessionMessage.textContent = "Start a session before using the NFC scanner.";
        dateDisplay.value = getLocalDate();
    }

    if (sessionChanged) {
        scannedStudents.clear();
        if (sessionId) {
            clearLatestScanResult();
        }
        listenToSessionAttendance(sessionId);
        lastObservedSessionId = sessionId;
    }
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
        if (getSessionId(activeSession)) {
            startSessionButton.disabled = true;
            endSessionButton.disabled = false;
            showToast("End the current session before starting another.", "warning");
            sessionMessage.textContent = "End the current session before starting another.";
            return;
        }

        const activeQuery = query(
            collection(db, "sessions"),
            where("facultyId", "==", currentFaculty.uid),
            where("status", "==", "active")
        );
        const snapshot = await getDocs(activeQuery);

        if (!snapshot.empty) {
            const existing = {
                id: snapshot.docs[0].id,
                ...snapshot.docs[0].data()
            };
            applyActiveSession(existing);
            showToast("End the current session before starting another.", "warning");
            sessionMessage.textContent =
                `An active session already exists: ${getSessionId(existing)}. End it before starting another.`;
            return;
        }

        // Always create a brand-new session document. Never reuse or update
        // an older sessionId when the subject or class changes.
        const sessionReference = doc(collection(db, "sessions"));
        const sessionId = sessionReference.id;
        const sessionDate = getLocalDate();
        const now = serverTimestamp();

        await setDoc(sessionReference, {
            sessionId,
            facultyId: currentFaculty.uid,
            facultyName: currentFaculty.name,
            subject,
            subjectName: subject,
            subjectCode,
            class: className,
            className,
            classId: className,
            semester,
            division,
            date: sessionDate,
            startTime: now,
            startedAt: now,
            status: "active",
            endTime: null,
            endedAt: null
        });

        const startedSession = {
            id: sessionId,
            sessionId,
            facultyId: currentFaculty.uid,
            facultyName: currentFaculty.name,
            subject,
            subjectName: subject,
            subjectCode,
            class: className,
            className,
            classId: className,
            semester,
            division,
            date: sessionDate,
            status: "active"
        };

        applyActiveSession(startedSession);
        showToast("Attendance session started.", "success");
        console.log("Active attendance session created:", sessionId);
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
        const endedSessionId = getSessionId(activeSession);
        await updateDoc(doc(db, "sessions", endedSessionId), {
            status: "completed",
            endTime: serverTimestamp(),
            endedAt: serverTimestamp()
        });

        applyActiveSession(null);
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

    if (!getSessionId(activeSession)) {
        showToast("Please start an attendance session first.", "warning");
        showResult(
            "Please start an attendance session first.",
            "Start a session, then scan the student's NFC card.",
            "error"
        );
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

    const hardwareUid = event.serialNumber || "Not available";
    console.log("NFC card detected.");
    console.log("Hardware UID (diagnostic only):", hardwareUid);
    console.log("Raw NFC data:", event.message);

    try {
        if (!getSessionId(activeSession)) {
            showResult(
                "Please start an attendance session first.",
                "Start a session, then scan the student's NFC card.",
                "error"
            );
            return;
        }

        const ndefResult = readStudentCodeFromNdef(event.message);
        console.log("Extracted Student ID:", ndefResult.studentId || "none");

        if (ndefResult.studentId) {
            await markStudentAttendance(ndefResult.studentId);
            return;
        }

        // Hardware UID is never treated as a student ID. It is only used when
        // a student document has that UID stored as a registered card field.
        const registeredStudent = await findStudentByRegisteredHardwareUid(event.serialNumber);
        if (registeredStudent) {
            console.log("Matched student name:", registeredStudent.name);
            await markStudentAttendance(
                normalizeStudentId(registeredStudent.studentId),
                registeredStudent
            );
            return;
        }

        if (!ndefResult.hasTextRecord) {
            showResult(
                "No NDEF text record",
                "This card was detected, but it does not contain a Tap2Present text record such as TAP2P:STU001.",
                "error"
            );
            return;
        }

        showResult(
            "Invalid NFC text format",
            ndefResult.rawText
                ? `Read "${ndefResult.rawText}", but the card must contain TAP2P: followed by the student ID.`
                : "The NFC text record could not be decoded into TAP2P:STUDENTID.",
            "error"
        );

    } catch (error) {
        console.error("Card reading error:", error);
        console.error("Firestore permission or scan error:", {
            code: error.code || "unknown",
            message: error.message
        });

        if (error.code === "STUDENT_NOT_FOUND") {
            showResult(
                "Student not found.",
                "No matching student was found in users for this NFC card.",
                "error"
            );
            return;
        }

        if (error.code === "NO_ACTIVE_SESSION") {
            showResult(
                "Please start an attendance session first.",
                "Start a session, then scan the student's NFC card.",
                "error"
            );
            return;
        }

        showResult(
            "Scan failed",
            getScanFailureMessage(error),
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

function getScanFailureMessage(error) {
    if (isPermissionError(error)) {
        return "Firestore permission error. This faculty account cannot read users or write attendance.";
    }

    return error.message || "Something went wrong while processing this card.";
}

function isPermissionError(error) {
    return error?.code === "permission-denied"
        || /permission-denied|insufficient permissions/i.test(error?.message || "");
}

function normalizeStudentId(value) {
    return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function getRecordBytes(data) {
    if (!data) return new Uint8Array();
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function decodeTextSafely(bytes, encoding) {
    try {
        return new TextDecoder(encoding || "utf-8").decode(bytes);
    } catch (error) {
        console.warn("Unable to decode NFC bytes with", encoding, error);
        return "";
    }
}

// Web NFC already exposes text as UTF-8/UTF-16 bytes.
// Raw NFC Forum text records still start with a language/status prefix.
function decodeNdefTextCandidates(record) {
    const bytes = getRecordBytes(record.data);
    const candidates = [];

    const webNfcText = decodeTextSafely(bytes, record.encoding || "utf-8");
    if (webNfcText) candidates.push(webNfcText);

    if (bytes.length > 1) {
        const statusByte = bytes[0];
        const languageLength = statusByte & 0x3f;
        const isUtf16 = (statusByte & 0x80) !== 0;

        if (languageLength <= 63 && bytes.length > 1 + languageLength) {
            const rawText = decodeTextSafely(
                bytes.slice(1 + languageLength),
                isUtf16 ? "utf-16" : "utf-8"
            );
            if (rawText) candidates.push(rawText);
        }
    }

    const utf8Fallback = decodeTextSafely(bytes, "utf-8");
    if (utf8Fallback) candidates.push(utf8Fallback);

    return [...new Set(candidates.map(text => text.replace(/\u0000/g, "").trim()).filter(Boolean))];
}

function parseTap2PresentStudentId(text) {
    const cleaned = String(text || "").replace(/\u0000/g, "").trim();
    if (!cleaned) return null;

    const match = cleaned.match(/TAP2P\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*)/i);
    if (!match) return null;

    return normalizeStudentId(match[1]);
}

// ---------------------------------------------
// EXTRACT STUDENT ID FROM NDEF MESSAGE
// ---------------------------------------------

function readStudentCodeFromNdef(message) {
    const records = message?.records || [];
    let hasTextRecord = false;
    let rawText = "";

    for (const record of records) {
        const recordType = record.recordType || "unknown";
        console.log("NDEF record type:", recordType);

        try {
            const decodedTexts = recordType === "text"
                ? decodeNdefTextCandidates(record)
                : [decodeTextSafely(getRecordBytes(record.data), "utf-8")].filter(Boolean);

            if (recordType === "text" && decodedTexts.length) {
                hasTextRecord = true;
            }

            for (const decodedText of decodedTexts) {
                console.log("Raw decoded text:", decodedText);
                rawText = rawText || decodedText;

                const studentId = parseTap2PresentStudentId(decodedText);
                if (studentId) {
                    console.log("Extracted Student ID:", studentId);
                    return {
                        studentId,
                        rawText: decodedText,
                        hasTextRecord: true
                    };
                }

                if (recordType === "text") {
                    hasTextRecord = true;
                }
            }
        } catch (error) {
            console.warn("Unable to decode NFC record:", error);
        }
    }

    return {
        studentId: null,
        rawText,
        hasTextRecord
    };
}

// ---------------------------------------------
// FIND STUDENT IN FIRESTORE
// ---------------------------------------------

function validateStudentDocument(studentDocument, studentCode) {
    const data = studentDocument.data();

    if (data.role !== "student") {
        throw new Error(`The matching document for ${studentCode} is not a student account.`);
    }

    if (String(data.status || "").toLowerCase() !== "active") {
        throw new Error(`Student ${studentCode} is inactive.`);
    }

    console.log("Matched student name:", data.name || "Unknown student");

    return {
        uid: studentDocument.id,
        ...data
    };
}

async function findStudent(studentCode) {
    const normalizedCode = normalizeStudentId(studentCode);
    console.log("Firestore collection searched: users");
    console.log("NFC student ID lookup:", normalizedCode);

    try {
        const studentIdQuery = query(
            collection(db, "users"),
            where("studentId", "==", normalizedCode)
        );
        const snapshot = await getDocs(studentIdQuery);
        console.log("Number of matching student documents:", snapshot.size);

        if (snapshot.empty) {
            const notFoundError = new Error("Student not found.");
            notFoundError.code = "STUDENT_NOT_FOUND";
            throw notFoundError;
        }

        const studentDocument = snapshot.docs.find((documentSnapshot) => {
            const data = documentSnapshot.data();
            return data.role === "student";
        }) || snapshot.docs[0];

        const data = studentDocument.data();
        console.log("Student academic details:", {
            name: data.name,
            studentId: data.studentId,
            className: data.className || data.classId || data.department || null,
            semester: data.semester ?? null,
            division: data.division || null
        });

        return validateStudentDocument(studentDocument, normalizedCode);
    } catch (error) {
        console.error("Firestore student lookup error:", {
            code: error.code || "unknown",
            message: error.message,
            studentId: normalizedCode
        });

        if (isPermissionError(error)) {
            throw new Error("Firestore permission error. This faculty account cannot search the users collection.");
        }

        throw error;
    }
}

async function findStudentByRegisteredHardwareUid(serialNumber) {
    if (!serialNumber) return null;

    const rawSerial = String(serialNumber).trim();
    const compactSerial = rawSerial.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const serialValues = [...new Set([
        rawSerial,
        rawSerial.toUpperCase(),
        compactSerial
    ].filter(Boolean))];

    console.log("Firestore collection searched: users (registered hardware UID only)");

    for (const fieldName of ["nfcCardUid", "nfcCardId", "cardId"]) {
        for (const serialValue of serialValues) {
            try {
                const serialQuery = query(
                    collection(db, "users"),
                    where(fieldName, "==", serialValue)
                );
                const snapshot = await getDocs(serialQuery);
                if (snapshot.empty) continue;

                console.log("Number of matching student documents:", snapshot.size);
                return validateStudentDocument(snapshot.docs[0], snapshot.docs[0].data().studentId);
            } catch (error) {
                console.warn("Registered hardware UID lookup skipped:", fieldName, error);
            }
        }
    }

    return null;
}

// ---------------------------------------------
// MARK ATTENDANCE
// ---------------------------------------------

async function markStudentAttendance(studentCode, knownStudent) {
    const sessionId = getSessionId(activeSession);

    if (!sessionId) {
        const sessionError = new Error("Please start an attendance session first.");
        sessionError.code = "NO_ACTIVE_SESSION";
        throw sessionError;
    }

    const subject = activeSession.subjectName || activeSession.subject || subjectInput.value.trim();
    const subjectCode = activeSession.subjectCode || subjectCodeInput.value.trim();
    const date = activeSession.date || getLocalDate();

    if (!subject) {
        throw new Error("Please enter a subject.");
    }

    console.log("Active session ID:", sessionId);

    showResult(
        "Verifying student",
        `Checking student ID ${studentCode}...`,
        "info"
    );
    startButton.disabled = true;
    stopButton.disabled = true;

    const student = knownStudent || await findStudent(studentCode);
    const displayStudentId = normalizeStudentId(student.studentId || studentCode);

    if (String(student.status || "").toLowerCase() !== "active") {
        throw new Error(`Student ${displayStudentId} is inactive.`);
    }

    const attendanceId = buildAttendanceDocumentId(sessionId, student.uid);
    const attendanceRef = doc(db, "attendance", attendanceId);
    const existingAttendance = await getDoc(attendanceRef);

    if (existingAttendance.exists()) {
        showResult(
            "Duplicate attendance – Already marked present.",
            `${student.name || displayStudentId} is already present in this session. The same card can still be used in a later session.`,
            "error"
        );
        return;
    }

    try {
        await runTransaction(db, async (transaction) => {
            const attendanceSnapshot = await transaction.get(attendanceRef);

            if (attendanceSnapshot.exists()) {
                throw new Error("DUPLICATE_ATTENDANCE");
            }

            transaction.set(attendanceRef, {
                studentId: student.uid,
                studentCode: displayStudentId,
                studentName: student.name || "Student",
                facultyId: currentFaculty.uid,
                facultyName: currentFaculty.name,
                scannedBy: currentFaculty.uid,
                subject,
                subjectCode,
                className: activeSession.className || activeSession.classId || classInput.value.trim(),
                semester: activeSession.semester ?? Number(semesterInput.value),
                division: activeSession.division || divisionInput.value.trim(),
                sessionId,
                date,
                time: getLocalTime(),
                status: "present",
                attendanceStatus: "present",
                scannedAt: serverTimestamp(),
                createdAt: serverTimestamp()
            });
        });
    } catch (error) {
        if (error.message === "DUPLICATE_ATTENDANCE") {
            showResult(
                "Duplicate attendance – Already marked present.",
                `${student.name || displayStudentId} is already present in this session. The same card can still be used in a later session.`,
                "error"
            );
            return;
        }

        if (isPermissionError(error)) {
            throw new Error("Firestore permission error. Attendance could not be recorded.");
        }

        throw error;
    }

    scannedStudents.add(student.uid);
    updateScanCount();

    showResult(
        "Attendance marked successfully.",
        `${student.name || "Student"} (${displayStudentId}) is marked PRESENT for ${subject}.`,
        "success"
    );

    showToast(
        `${student.name || displayStudentId} marked present.`,
        "success"
    );
    console.log("Attendance successfully recorded:", {
        studentId: displayStudentId,
        uid: student.uid,
        sessionId,
        attendanceId,
        subject,
        date
    });
}

// ---------------------------------------------
// ADD STUDENT TO TODAY'S TABLE
// ---------------------------------------------
// Session attendance rows are rendered from the Firestore listener so
// Today's Scans always matches the active sessionId.

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
