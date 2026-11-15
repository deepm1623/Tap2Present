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
    where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const studentName = document.getElementById("studentName");
const headerStudentName = document.getElementById("headerStudentName");
const studentInitial = document.getElementById("studentInitial");
const attendancePercentage = document.getElementById("attendancePercentage");
const totalClasses = document.getElementById("totalClasses");
const presentClasses = document.getElementById("presentClasses");
const absentClasses = document.getElementById("absentClasses");
const recentAttendance = document.getElementById("recentAttendance");
const subjectAttendance = document.getElementById("subjectAttendance");
const dashboardMessage = document.getElementById("dashboardMessage");
const dashboardRetry = document.getElementById("dashboardRetry");
const attendanceAlert = document.getElementById("attendanceAlert");
const logoutButton = document.getElementById("logoutButton");

let activeUser = null;
let loading = false;

logoutButton?.addEventListener("click", async () => {
    const confirmed = await window.showConfirm({
        title: "Log out of Tap2Present?",
        message: "You will need to sign in again to view your dashboard.",
        confirmText: "Log out"
    });

    if (!confirmed) return;

    try {
        await signOut(auth);
        window.location.href = "student-login.html";
    } catch (error) {
        console.error("Student dashboard logout failed:", error.code || error.name);
        window.showToast("Unable to logout. Please try again.", "error", "Logout failed");
    }
});

dashboardRetry?.addEventListener("click", () => {
    if (activeUser) loadDashboard(activeUser);
});

onAuthStateChanged(auth, user => {
    if (!user) {
        window.location.href = "student-login.html";
        return;
    }

    activeUser = user;
    loadDashboard(user);
});

async function loadDashboard(user) {
    if (loading) return;
    loading = true;
    setDashboardState("Loading your profile...");
    clearDashboardContent();

    try {
        const profileSnapshot = await getDoc(doc(db, "users", user.uid));

        if (!profileSnapshot.exists()) {
            await signOut(auth);
            window.location.href = "student-login.html";
            return;
        }

        const profile = profileSnapshot.data();

        if (profile.role !== "student") {
            await signOut(auth);
            window.location.href = "../login.html";
            return;
        }

        if (profile.status !== "active") {
            setDashboardState("Your account is waiting for approval.", true);
            await signOut(auth);
            return;
        }

        updateStudentHeader(profile);
        setDashboardState("Loading attendance records...");

        const attendanceQuery = query(
            collection(db, "attendance"),
            where("studentId", "==", user.uid)
        );
        const attendanceSnapshot = await getDocs(attendanceQuery);
        const records = attendanceSnapshot.docs.map(attendanceDocument => ({
            id: attendanceDocument.id,
            ...attendanceDocument.data()
        }));

        calculateAttendance(records);
        renderAttendanceAlert(records, profile);
        displaySubjectAttendance(records);
        displayRecentAttendance(records);
        setDashboardState("");
    } catch (error) {
        console.error("Student dashboard data load failed:", error.code || error.name);
        setDashboardState(getDashboardErrorMessage(error), true);
        renderLoadError();
    } finally {
        loading = false;
    }
}

function updateStudentHeader(profile) {
    const name = profile.name || "Student";
    studentName.textContent = name;
    headerStudentName.textContent = name;
    studentInitial.textContent = name.charAt(0).toUpperCase();
}

function calculateAttendance(records) {
    const validRecords = records.filter(record => isAttendanceStatus(record.status));
    const present = validRecords.filter(record =>
        String(record.status).toLowerCase() === "present"
    ).length;
    const absent = validRecords.filter(record =>
        String(record.status).toLowerCase() === "absent"
    ).length;
    const total = present + absent;
    const percentage = total ? Math.round((present / total) * 100) : 0;

    attendancePercentage.textContent = `${percentage}%`;
    totalClasses.textContent = total;
    presentClasses.textContent = present;
    absentClasses.textContent = absent;
}

function displaySubjectAttendance(records) {
    const subjects = new Map();

    records.forEach(record => {
        const subject = String(record.subject || "").trim();
        const status = String(record.status || "").toLowerCase();

        if (!subject || !isAttendanceStatus(status)) return;

        const summary = subjects.get(subject) || {
            total: 0,
            present: 0,
            absent: 0
        };
        summary.total += 1;
        summary[status] += 1;
        subjects.set(subject, summary);
    });

    subjectAttendance.replaceChildren();

    if (!subjects.size) {
        subjectAttendance.innerHTML = `
            <div class="empty-state">
                <strong>No attendance records found.</strong>
                Subject summaries will appear after attendance is recorded.
            </div>
        `;
        return;
    }

    subjects.forEach((summary, subject) => {
        const percentage = Math.round((summary.present / summary.total) * 100);
        const card = document.createElement("article");
        card.className = "subject-card";
        card.innerHTML = `
            <h3></h3>
            <p class="subject-meta"></p>
            <div class="progress-track" aria-label="${percentage}% attendance">
                <div class="progress-value"></div>
            </div>
        `;
        card.querySelector("h3").textContent = subject;
        card.querySelector(".subject-meta").textContent =
            `${summary.present} present · ${summary.absent} absent · ${percentage}%`;
        card.querySelector(".progress-value").style.width = `${percentage}%`;
        subjectAttendance.appendChild(card);
    });
}

function displayRecentAttendance(records) {
    const sortedRecords = [...records]
        .sort((first, second) => getRecordTimestamp(second) - getRecordTimestamp(first))
        .slice(0, 5);

    recentAttendance.replaceChildren();

    if (!sortedRecords.length) {
        recentAttendance.innerHTML = `
            <div class="empty-history">
                <strong>No attendance records found.</strong>
                Your recent attendance will appear here.
            </div>
        `;
        return;
    }

    sortedRecords.forEach(record => {
        const row = document.createElement("div");
        row.className = "history-row";

        const subject = document.createElement("span");
        subject.textContent = record.subject || "Unknown Subject";

        const date = document.createElement("span");
        date.textContent = record.date || "Not available";

        const time = document.createElement("span");
        time.textContent = record.time || "Not available";

        const status = document.createElement("span");
        const statusValue = String(record.status || "").toLowerCase();
        status.className = `status-badge ${
            statusValue === "present" ? "status-present" :
                statusValue === "absent" ? "status-absent" : ""
        }`;
        status.textContent = statusValue
            ? statusValue.charAt(0).toUpperCase() + statusValue.slice(1)
            : "Unknown";

        row.append(subject, date, time, status);
        recentAttendance.appendChild(row);
    });
}

function renderAttendanceAlert(records, profile) {
    const requirement = Number(
        profile.attendanceRequirement ?? profile.minimumAttendancePercentage
    );
    const validRequirement = Number.isFinite(requirement) &&
        requirement >= 0 &&
        requirement <= 100;
    const validRecords = records.filter(record => isAttendanceStatus(record.status));

    attendanceAlert.hidden = false;

    if (!validRequirement) {
        attendanceAlert.className = "alert-card";
        attendanceAlert.textContent =
            "The college attendance requirement is not configured for your account.";
        return;
    }

    if (!validRecords.length) {
        attendanceAlert.className = "alert-card";
        attendanceAlert.textContent =
            `The ${requirement}% requirement will be evaluated after records are available.`;
        return;
    }

    const present = validRecords.filter(record =>
        String(record.status).toLowerCase() === "present"
    ).length;
    const percentage = Math.round((present / validRecords.length) * 100);
    attendanceAlert.className = percentage >= requirement
        ? "alert-card success"
        : "alert-card";
    attendanceAlert.textContent = percentage >= requirement
        ? `Attendance is sufficient at ${percentage}% (requirement: ${requirement}%).`
        : `Attendance is below the configured ${requirement}% requirement at ${percentage}%.`;
}

function getRecordTimestamp(record) {
    const combined = `${record.date || ""} ${record.time || ""}`.trim();
    const parsed = Date.parse(combined);
    if (!Number.isNaN(parsed)) return parsed;
    if (record.createdAt?.toMillis) return record.createdAt.toMillis();
    return 0;
}

function isAttendanceStatus(status) {
    return ["present", "absent"].includes(String(status || "").toLowerCase());
}

function clearDashboardContent() {
    attendancePercentage.textContent = "--%";
    totalClasses.textContent = "--";
    presentClasses.textContent = "--";
    absentClasses.textContent = "--";
    subjectAttendance.innerHTML = "<div class=\"empty-state\">Loading subject attendance...</div>";
    recentAttendance.innerHTML = "<div class=\"empty-history\">Loading attendance records...</div>";
    attendanceAlert.hidden = true;
    dashboardRetry.hidden = true;
}

function setDashboardState(message, isError = false) {
    dashboardMessage.textContent = message;
    dashboardMessage.classList.toggle("error", isError);
}

function renderLoadError() {
    subjectAttendance.innerHTML = `
        <div class="empty-state error-state">
            <strong>Unable to load subject attendance.</strong>
            Try again using the retry button.
        </div>
    `;
    recentAttendance.innerHTML = `
        <div class="empty-history error-state">
            <strong>Unable to load attendance records.</strong>
            Try again using the retry button.
        </div>
    `;
    dashboardRetry.hidden = false;
}

function getDashboardErrorMessage(error) {
    if (error.code === "permission-denied") {
        return "Attendance data access was denied. Please check your Firestore rules.";
    }
    if (error.code === "unavailable" || error.code === "network-request-failed") {
        return "Attendance data is temporarily unavailable. Check your connection and retry.";
    }
    return "Unable to load dashboard data. Please retry.";
}
