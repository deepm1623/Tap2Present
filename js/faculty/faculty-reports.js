import { requireRole, logout } from "../auth.js";
import { db } from "../../firebase-config.js";
import {
    collection,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const session = await requireRole("faculty");
document.querySelector("[data-logout]").addEventListener("click", async (event) => {
    event.preventDefault();
    await logout();
});

const reportsMessage = document.getElementById("reportsMessage");
const subjectSummary = document.getElementById("subjectSummary");
const reportsTableBody = document.getElementById("reportsTableBody");

try {
    const snapshot = await getDocs(query(
        collection(db, "attendance"),
        where("facultyId", "==", session.user.uid)
    ));
    const records = snapshot.docs.map(documentSnapshot => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data()
    })).sort((left, right) => getTimestamp(right) - getTimestamp(left));

    renderSubjectSummary(records);
    renderRecentRecords(records.slice(0, 20));
    reportsMessage.textContent = records.length
        ? `${records.length} attendance record(s) found for your account.`
        : "";
} catch (error) {
    console.error("Faculty reports error:", error);
    reportsMessage.textContent = error.code === "permission-denied"
        ? "Firestore permission error. Unable to read attendance reports."
        : "Unable to load attendance reports.";
    reportsTableBody.innerHTML = '<tr><td colspan="4" class="empty-history">Reports are unavailable.</td></tr>';
}

function renderSubjectSummary(records) {
    const subjects = new Map();
    records.forEach(record => {
        const subject = record.subject || "Unspecified subject";
        const status = String(record.attendanceStatus || record.status || "").toLowerCase();
        const summary = subjects.get(subject) || { total: 0, present: 0 };
        summary.total += 1;
        if (status === "present") summary.present += 1;
        subjects.set(subject, summary);
    });

    if (!subjects.size) {
        subjectSummary.innerHTML = '<p class="empty-history">Reports will appear after attendance data is recorded.</p>';
        return;
    }

    subjectSummary.replaceChildren();
    subjects.forEach((summary, subject) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = `${subject}: ${summary.present}/${summary.total} present`;
        subjectSummary.appendChild(paragraph);
    });
}

function renderRecentRecords(records) {
    reportsTableBody.innerHTML = "";
    if (!records.length) {
        reportsTableBody.innerHTML = '<tr><td colspan="4" class="empty-history">No attendance records yet.</td></tr>';
        return;
    }

    records.forEach(record => {
        const row = document.createElement("tr");
        const status = String(record.attendanceStatus || record.status || "present");
        [record.studentName || record.studentCode || "Student", record.subject || "-", record.date || "-", status]
            .forEach(value => {
                const cell = document.createElement("td");
                cell.textContent = value;
                row.appendChild(cell);
            });
        reportsTableBody.appendChild(row);
    });
}

function getTimestamp(record) {
    const value = record.scannedAt || record.createdAt;
    if (value?.toMillis) return value.toMillis();
    return new Date(record.date || 0).getTime() || 0;
}
