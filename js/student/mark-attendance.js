import { db } from "../../firebase-config.js";
import { setupStudentPortal } from "./student-portal.js";
import {
    collection,
    onSnapshot,
    query,
    where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const sessionBadge = document.getElementById("sessionBadge");
const sessionSubject = document.getElementById("sessionSubject");
const sessionStatus = document.getElementById("sessionStatus");
const sessionFaculty = document.getElementById("sessionFaculty");
const sessionClass = document.getElementById("sessionClass");
const sessionStarted = document.getElementById("sessionStarted");
const readerTitle = document.getElementById("readerTitle");
const readerDescription = document.getElementById("readerDescription");
const cardStatus = document.getElementById("cardStatus");
const lastScan = document.getElementById("lastScan");

const session = await setupStudentPortal();
const profile = session.profile;
const registeredCard = profile.nfcCardId || profile.nfcCardUid || profile.cardId;
const hasRegistration = Boolean(profile.nfcRegistered === true || registeredCard);

cardStatus.textContent = hasRegistration
    ? "Registered card information is available."
    : "No NFC registration information is stored for this account.";

if (profile.lastNfcScanAt) {
    lastScan.textContent = `Last successful scan: ${formatTimestamp(profile.lastNfcScanAt)}`;
}

setSessionState("loading");

const sessionsQuery = query(
    collection(db, "sessions"),
    where("status", "in", ["active", "stopped"])
);

const unsubscribe = onSnapshot(
    sessionsQuery,
    snapshot => {
        const applicableSessions = snapshot.docs
            .map(document => ({ id: document.id, ...document.data() }))
            .filter(isApplicableSession)
            .sort((left, right) => getTimestamp(right.startedAt) - getTimestamp(left.startedAt));

        const activeSession = applicableSessions.find(item => item.status === "active");
        const stoppedSession = applicableSessions.find(item => item.status === "stopped");

        if (activeSession) {
            renderSession(activeSession);
        } else if (stoppedSession) {
            renderSession(stoppedSession);
        } else {
            setSessionState("empty");
        }
    },
    error => {
        console.error("Attendance session listener error:", error);
        setSessionState("error");
    }
);

window.addEventListener("pagehide", unsubscribe, { once: true });

function isApplicableSession(sessionData) {
    return ["classId", "className", "semester", "division"].every(field => {
        if (sessionData[field] === undefined || sessionData[field] === null || sessionData[field] === "") {
            return true;
        }
        return String(sessionData[field]).toLowerCase() === String(profile[field] || "").toLowerCase();
    });
}

function renderSession(sessionData) {
    const isActive = sessionData.status === "active";
    sessionBadge.textContent = isActive ? "Active Session" : "Session Ended";
    sessionBadge.className = `session-badge ${isActive ? "active" : "ended"}`;
    sessionSubject.textContent = sessionData.subjectName || sessionData.subject || "Attendance session";
    sessionFaculty.textContent = sessionData.facultyName || "Faculty";
    sessionClass.textContent = getClassDetails(sessionData);
    sessionStarted.textContent = formatTimestamp(sessionData.startedAt);
    sessionStatus.textContent = isActive
        ? "Attendance is currently available."
        : "Attendance is no longer being accepted for this session.";
    readerTitle.textContent = isActive
        ? "Tap your card at the authorized reader"
        : "This session has ended";
    readerDescription.textContent = isActive
        ? "Keep your registered card ready and tap it on the authorized faculty reader."
        : "Wait for faculty to start a new attendance session.";
}

function setSessionState(state) {
    sessionBadge.className = `session-badge ${state}`;

    if (state === "loading") {
        sessionBadge.textContent = "Checking session";
        sessionSubject.textContent = "Attendance session";
        sessionStatus.textContent = "Loading active session...";
        readerTitle.textContent = "Checking attendance availability";
        return;
    }

    if (state === "error") {
        sessionBadge.textContent = "Unavailable";
        sessionSubject.textContent = "Attendance session";
        sessionStatus.textContent = "Unable to load attendance sessions. Please try again later.";
        readerTitle.textContent = "Attendance availability is unavailable";
        readerDescription.textContent = "The session service could not be reached.";
        return;
    }

    sessionBadge.textContent = "No active session";
    sessionSubject.textContent = "Attendance unavailable";
    sessionFaculty.textContent = "-";
    sessionClass.textContent = "-";
    sessionStarted.textContent = "-";
    sessionStatus.textContent = "Wait for faculty to start a session.";
    readerTitle.textContent = "Waiting for authorized reader";
    readerDescription.textContent = "Attendance is currently unavailable. Faculty must start a session first.";
}

function getClassDetails(sessionData) {
    const details = [];
    if (sessionData.className || sessionData.classId) {
        details.push(sessionData.className || sessionData.classId);
    }
    if (sessionData.semester !== undefined && sessionData.semester !== null) {
        details.push(`Semester ${sessionData.semester}`);
    }
    if (sessionData.division) {
        details.push(`Division ${sessionData.division}`);
    }
    return details.length ? details.join(" · ") : "All eligible classes";
}

function getTimestamp(value) {
    if (value?.toMillis) return value.toMillis();
    const timestamp = new Date(value || 0).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatTimestamp(value) {
    if (value?.toDate) return value.toDate().toLocaleString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}
