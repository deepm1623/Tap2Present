import { setupStudentPortal } from "./student-portal.js";

const session = await setupStudentPortal();
const profile = session.profile;
const cardStatus = document.getElementById("cardStatus");
const lastScan = document.getElementById("lastScan");
const sessionStatus = document.getElementById("sessionStatus");
const attendanceMessage = document.getElementById("attendance-message");

const registeredCard = profile.nfcCardId || profile.nfcCardUid || profile.cardId;
const hasRegistration = Boolean(
    profile.nfcRegistered === true || registeredCard
);

cardStatus.textContent = hasRegistration
    ? "Registered card information is available."
    : "No NFC registration information is stored for this account.";

if (profile.lastNfcScanAt) {
    lastScan.textContent = `Last successful scan: ${formatTimestamp(profile.lastNfcScanAt)}`;
}

if (profile.activeAttendanceSession) {
    sessionStatus.textContent = "An attendance session is available.";
} else {
    sessionStatus.textContent =
        "No active session information is available. The faculty portal controls session availability.";
}

attendanceMessage.textContent =
    "Use the authorized campus reader. This page cannot mark attendance directly.";

function formatTimestamp(value) {
    if (value?.toDate) return value.toDate().toLocaleString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}
