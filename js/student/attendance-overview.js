import { setupStudentPortal } from "./student-portal.js";
import { db } from "../../firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const session = await setupStudentPortal();
const overviewMessage = document.getElementById("overviewMessage");
const subjectChart = document.getElementById("subjectChart");
const alert = document.getElementById("overviewAlert");

try {
    const recordsSnapshot = await getDocs(query(
        collection(db, "attendance"),
        where("studentId", "==", session.user.uid)
    ));
    const records = recordsSnapshot.docs.map(document => document.data());
    renderOverview(records, session.profile);
    overviewMessage.textContent = "";
} catch (error) {
    console.error("Attendance overview error:", error);
    overviewMessage.textContent = error.code === "permission-denied"
        ? "You do not have permission to view attendance records."
        : "Unable to load attendance overview.";
}

function renderOverview(records, profile) {
    const validRecords = records.filter(record =>
        ["present", "absent"].includes(getRecordStatus(record))
    );
    const present = validRecords.filter(record => getRecordStatus(record) === "present").length;
    const absent = validRecords.length - present;
    const percentage = validRecords.length
        ? Math.round((present / validRecords.length) * 100)
        : 0;

    document.getElementById("overviewPercentage").textContent = `${percentage}%`;
    document.getElementById("overviewTotal").textContent = validRecords.length;
    document.getElementById("overviewPresent").textContent = present;
    document.getElementById("overviewAbsent").textContent = absent;

    const subjects = new Map();
    validRecords.forEach(record => {
        const subject = String(record.subject || "").trim();
        if (!subject) return;
        const summary = subjects.get(subject) || { total: 0, present: 0 };
        summary.total += 1;
        if (getRecordStatus(record) === "present") summary.present += 1;
        subjects.set(subject, summary);
    });

    subjectChart.replaceChildren();
    if (!subjects.size) {
        subjectChart.innerHTML = '<div class="empty-state"><strong>No subject data yet</strong>Subject comparisons will appear after records are available.</div>';
    } else {
        subjects.forEach((summary, subject) => {
            const value = Math.round((summary.present / summary.total) * 100);
            const card = document.createElement("article");
            card.className = "subject-card";
            card.innerHTML = '<h3></h3><p class="subject-meta"></p><div class="progress-track"><div class="progress-value"></div></div>';
            card.querySelector("h3").textContent = subject;
            card.querySelector(".subject-meta").textContent = `${value}% · ${summary.present}/${summary.total} present`;
            card.querySelector(".progress-value").style.width = `${value}%`;
            subjectChart.appendChild(card);
        });
    }

    const requirement = Number(profile.attendanceRequirement ?? profile.minimumAttendancePercentage);
    alert.hidden = false;
    if (!Number.isFinite(requirement) || requirement < 0 || requirement > 100) {
        alert.className = "alert-card";
        alert.textContent = "The college attendance requirement is not configured for your account.";
        return;
    }

    if (!validRecords.length) {
        alert.className = "alert-card";
        alert.textContent =
            `The ${requirement}% attendance requirement will be evaluated after records are available.`;
        return;
    }

    alert.className = percentage >= requirement ? "alert-card success" : "alert-card";
    alert.textContent = percentage >= requirement
        ? `Attendance is above the configured ${requirement}% requirement.`
        : `Attendance is below the configured ${requirement}% requirement.`;
}

function getRecordStatus(record) {
    return String(record?.attendanceStatus || record?.status || "").toLowerCase();
}
