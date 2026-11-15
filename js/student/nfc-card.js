import { setupStudentPortal } from "./student-portal.js";

const session = await setupStudentPortal();
const profile = session.profile;
const cardIdentifier = profile.nfcCardId || profile.nfcCardUid || profile.cardId;
const registered = profile.nfcRegistered === true || Boolean(cardIdentifier);

document.getElementById("registrationStatus").textContent = registered
    ? "Registered"
    : "Not registered";
document.getElementById("cardIdentifier").textContent = cardIdentifier
    ? maskIdentifier(cardIdentifier)
    : "Not available";
document.getElementById("registeredAt").textContent = formatTimestamp(
    profile.nfcRegisteredAt
);
document.getElementById("activationStatus").textContent =
    profile.nfcActive === undefined ? "Not available" : profile.nfcActive ? "Active" : "Inactive";
document.getElementById("lastScan").textContent = formatTimestamp(profile.lastNfcScanAt);

function maskIdentifier(value) {
    const text = String(value);
    return text.length <= 4 ? "••••" : `${"•".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

function formatTimestamp(value) {
    if (!value) return "Not available";
    if (value.toDate) return value.toDate().toLocaleString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}
