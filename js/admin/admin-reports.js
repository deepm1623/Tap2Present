import { requireRole, logout } from "../auth.js";
import { db } from "../../firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

await requireRole("admin");
document.querySelector("[data-logout]").addEventListener("click", async (event) => {
    event.preventDefault();
    await logout();
});

const reportsMessage = document.getElementById("reportsMessage");
const reportsTableBody = document.getElementById("reportsTableBody");

try {
    const snapshot = await getDocs(collection(db, "attendance"));
    const records = snapshot.docs.map(documentSnapshot => documentSnapshot.data())
        .sort((left, right) => getTimestamp(right) - getTimestamp(left));

    const present = records.filter(record =>
        String(record.attendanceStatus || record.status || "").toLowerCase() === "present"
    ).length;
    const subjects = new Set(records.map(record => record.subject).filter(Boolean));
    const faculty = new Set(records.map(record => record.facultyId || record.scannedBy).filter(Boolean));

    document.getElementById("totalRecords").textContent = records.length;
    document.getElementById("presentRecords").textContent = present;
    document.getElementById("subjectCount").textContent = subjects.size;
    document.getElementById("facultyCount").textContent = faculty.size;

    reportsTableBody.innerHTML = "";
    if (!records.length) {
        reportsTableBody.innerHTML = '<tr><td colspan="4" class="empty-history">No attendance records have been stored yet.</td></tr>';
        reportsMessage.textContent = "";
    } else {
        records.slice(0, 25).forEach(record => {
            const row = document.createElement("tr");
            [
                record.studentName || record.studentCode || "Student",
                record.subject || "-",
                record.facultyName || "Faculty",
                record.date || "-"
            ].forEach(value => {
                const cell = document.createElement("td");
                cell.textContent = value;
                row.appendChild(cell);
            });
            reportsTableBody.appendChild(row);
        });
        reportsMessage.textContent = `Showing the ${Math.min(25, records.length)} most recent records.`;
    }
} catch (error) {
    console.error("Admin reports error:", error);
    reportsMessage.textContent = error.code === "permission-denied"
        ? "Firestore permission error. Unable to read institution reports."
        : "Unable to load institution reports.";
    reportsTableBody.innerHTML = '<tr><td colspan="4" class="empty-history">Reports are unavailable.</td></tr>';
}

function getTimestamp(record) {
    const value = record.scannedAt || record.createdAt;
    if (value?.toMillis) return value.toMillis();
    return new Date(record.date || 0).getTime() || 0;
}
