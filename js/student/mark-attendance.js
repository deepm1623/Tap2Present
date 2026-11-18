import { db } from "../../firebase-config.js";
import { setupStudentPortal } from "./student-portal.js";
import {
    collection,
    onSnapshot,
    query,
    where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const pageMessage = document.getElementById("pageMessage");
const statusStudentId = document.getElementById("statusStudentId");
const statusStudentName = document.getElementById("statusStudentName");
const statusRegistration = document.getElementById("statusRegistration");
const statusCardUid = document.getElementById("statusCardUid");
const cardStatusBadge = document.getElementById("cardStatusBadge");
const cardStatusNote = document.getElementById("cardStatusNote");
const latestResult = document.getElementById("latestResult");
const latestStatusBadge = document.getElementById("latestStatusBadge");
const recentHistory = document.getElementById("recentHistory");

let unsubscribeAttendance = null;

try {
    const session = await setupStudentPortal();
    const studentUid = session.user.uid;
    const profile = session.profile || {};

    renderCardStatus(profile);
    listenForAttendance(studentUid, profile);
} catch (error) {
    console.error("Mark attendance page error:", error);
    setPageMessage("Unable to verify your student account. Please sign in again.", true);
}

function renderCardStatus(profile) {
    const studentId = profile.studentId || "Not assigned";
    const studentName = profile.name || "Student";
    const cardUid = profile.nfcCardId || profile.nfcCardUid || profile.cardId || "";
    const registered = profile.nfcRegistered === true || Boolean(cardUid);

    statusStudentId.textContent = studentId;
    statusStudentName.textContent = studentName;
    statusRegistration.textContent = registered ? "Registered" : "Not registered";
    statusCardUid.textContent = cardUid || "Not available";

    cardStatusBadge.textContent = registered ? "Registered" : "Not Registered";
    cardStatusBadge.className = `card-status-badge ${registered ? "registered" : "missing"}`;
    cardStatusNote.textContent = registered
        ? "Your NFC card is linked to this student account. Tap it on the authorized campus reader."
        : "No NFC card is registered on this account. Ask an administrator to register your card.";

    if (!profile.studentId) {
        setPageMessage("Your student ID is missing from your profile. Contact the administrator.", true);
    } else {
        setPageMessage("");
    }
}

function listenForAttendance(studentUid, profile) {
    const attendanceQuery = query(
        collection(db, "attendance"),
        where("studentId", "==", studentUid)
    );

    unsubscribeAttendance = onSnapshot(
        attendanceQuery,
        snapshot => {
            const records = snapshot.docs
                .map(attendanceDocument => ({
                    id: attendanceDocument.id,
                    ...attendanceDocument.data()
                }))
                .sort((left, right) => getRecordTimestamp(right) - getRecordTimestamp(left));

            renderLatestResult(records[0], profile);
            renderRecentHistory(records.slice(0, 6));
        },
        error => {
            console.error("Student attendance listener error:", error);
            latestStatusBadge.textContent = "Unavailable";
            latestStatusBadge.className = "result-badge error";
            latestResult.innerHTML = emptyState(
                "Unable to load attendance",
                isPermissionError(error)
                    ? "Firestore permission error. Your account cannot read attendance records."
                    : "Attendance records could not be loaded. Please refresh and try again."
            );
            recentHistory.innerHTML = emptyState(
                "History unavailable",
                "Recent attendance could not be loaded from Firestore."
            );
            setPageMessage("Unable to load attendance records.", true);
        }
    );
}

function renderLatestResult(record, profile) {
    if (!record) {
        latestStatusBadge.textContent = "Waiting";
        latestStatusBadge.className = "result-badge idle";
        latestResult.innerHTML = emptyState(
            "No recent attendance yet",
            "When faculty scans your card, your name, subject, and time will appear here."
        );
        return;
    }

    const status = getAttendanceStatus(record);
    latestStatusBadge.textContent = status;
    latestStatusBadge.className = `result-badge ${status === "Present" ? "present" : "absent"}`;

    latestResult.innerHTML = `
        <dl class="result-details">
            <div><dt>Student name</dt><dd>${escapeHTML(record.studentName || profile.name || "Student")}</dd></div>
            <div><dt>Student ID</dt><dd>${escapeHTML(record.studentCode || profile.studentId || "Not assigned")}</dd></div>
            <div><dt>Subject</dt><dd>${escapeHTML(record.subject || "Subject unavailable")}</dd></div>
            <div><dt>Faculty</dt><dd>${escapeHTML(record.facultyName || "Faculty")}</dd></div>
            <div><dt>Date</dt><dd>${escapeHTML(formatDate(record))}</dd></div>
            <div><dt>Attendance time</dt><dd>${escapeHTML(record.time || formatTime(record))}</dd></div>
            <div><dt>Status</dt><dd>${escapeHTML(status)}</dd></div>
        </dl>
    `;
}

function renderRecentHistory(records) {
    if (!records.length) {
        recentHistory.innerHTML = emptyState(
            "No records to show",
            "Your recent present and absent entries will list here."
        );
        return;
    }

    recentHistory.replaceChildren();

    records.forEach(record => {
        const status = getAttendanceStatus(record);
        const item = document.createElement("article");
        item.className = "recent-item";
        item.innerHTML = `
            <div>
                <strong>${escapeHTML(record.subject || "Subject")}</strong>
                <p>${escapeHTML(getSessionLabel(record))}</p>
            </div>
            <div class="recent-meta">
                <span>${escapeHTML(formatDate(record))}</span>
                <span>${escapeHTML(record.time || formatTime(record))}</span>
                <span class="status-badge ${status === "Present" ? "status-present" : "status-absent"}">${escapeHTML(status)}</span>
            </div>
        `;
        recentHistory.appendChild(item);
    });
}

function getSessionLabel(record) {
    const sessionId = record.sessionId ? String(record.sessionId).slice(0, 8) : "";
    const faculty = record.facultyName || "Faculty";
    return sessionId ? `${faculty} · Session ${sessionId}` : faculty;
}

function getAttendanceStatus(record) {
    const value = String(record.attendanceStatus || record.status || "present").toLowerCase();
    return value === "absent" ? "Absent" : "Present";
}

function getRecordTimestamp(record) {
    const value = record.scannedAt || record.createdAt || record.date;
    if (value?.toMillis) return value.toMillis();
    const timestamp = new Date(value || 0).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatDate(record) {
    if (record.date) return String(record.date);
    const value = record.scannedAt || record.createdAt;
    if (value?.toDate) {
        return value.toDate().toLocaleDateString("en-IN");
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString("en-IN");
}

function formatTime(record) {
    const value = record.scannedAt || record.createdAt;
    if (value?.toDate) {
        return value.toDate().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        });
    }
    return "Time unavailable";
}

function emptyState(title, message) {
    return `<div class="result-empty"><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p></div>`;
}

function setPageMessage(message, isError = false) {
    pageMessage.textContent = message;
    pageMessage.classList.toggle("error", Boolean(isError && message));
}

function isPermissionError(error) {
    return error?.code === "permission-denied"
        || /permission-denied|insufficient permissions/i.test(error?.message || "");
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

window.addEventListener("pagehide", () => {
    unsubscribeAttendance?.();
}, { once: true });
