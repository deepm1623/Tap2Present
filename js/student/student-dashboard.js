import { auth, db } from "../../firebase-config.js";
import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    query,
    where,
    onSnapshot
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
const attendanceSessions = document.getElementById("attendanceSessions");
const activeSessionsCount = document.getElementById("activeSessionsCount");

let activeUser = null;
let loading = false;
let unsubscribeSessions = null;
let unsubscribeAttendance = null;

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

window.addEventListener("pagehide", () => {
    unsubscribeSessions?.();
    unsubscribeAttendance?.();
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
        listenForAttendanceSessions(profile);
        listenForAttendanceRecords(user.uid, profile);
        setDashboardState("Loading attendance records...");
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

function listenForAttendanceSessions(profile) {
    unsubscribeSessions?.();

    console.log("Active session query: collection=sessions, status in [active,completed,stopped]");
    console.log("Student academic details:", {
        className: profile.className || profile.classId || profile.department || null,
        semester: profile.semester ?? null,
        division: profile.division || null
    });

    const sessionsQuery = query(
        collection(db, "sessions"),
        where("status", "in", ["active", "completed", "stopped"])
    );

    unsubscribeSessions = onSnapshot(
        sessionsQuery,
        snapshot => {
            const sessions = snapshot.docs
                .map(sessionDocument => ({
                    id: sessionDocument.id,
                    ...sessionDocument.data()
                }))
                .filter(sessionData => isSessionApplicableToStudent(sessionData, profile))
                .sort((left, right) =>
                    getSessionTimestamp(right.startTime || right.startedAt) -
                    getSessionTimestamp(left.startTime || left.startedAt));

            console.log("Active session query result:", snapshot.size);
            console.log("Session matching results:", sessions.map(sessionData => ({
                id: sessionData.id,
                status: sessionData.status,
                className: sessionData.className || sessionData.classId || sessionData.class || null,
                semester: sessionData.semester ?? null,
                division: sessionData.division || null
            })));
            renderAttendanceSessions(sessions, profile);
        },
        error => {
            console.error("Student attendance sessions listener error:", error);
            attendanceSessions.innerHTML =
                '<div class="empty-state error-state"><strong>Unable to load attendance sessions.</strong></div>';
            activeSessionsCount.textContent = "Unavailable";
        }
    );
}

function isSessionApplicableToStudent(sessionData, profile) {
    const profileClass = profile.className || profile.classId || profile.class || profile.department || "";
    const sessionClass = sessionData.className || sessionData.classId || sessionData.class || "";

    if (!profileClass || profile.semester == null || profile.division == null) {
        console.warn("Student profile academic details are incomplete:", {
            className: profileClass || null,
            semester: profile.semester ?? null,
            division: profile.division || null
        });
        return false;
    }

    if (sessionClass && profileClass &&
        normalizeAcademicValue(sessionClass) !== normalizeAcademicValue(profileClass)) {
        return false;
    }

    if (sessionData.semester && profile.semester &&
        normalizeAcademicValue(sessionData.semester) !== normalizeAcademicValue(profile.semester)) {
        return false;
    }

    if (sessionData.division && profile.division &&
        normalizeAcademicValue(sessionData.division) !== normalizeAcademicValue(profile.division)) {
        return false;
    }

    return true;
}

function normalizeAcademicValue(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

function renderAttendanceSessions(sessions, profile) {
    attendanceSessions.replaceChildren();
    const activeCount = sessions.filter(sessionData => sessionData.status === "active").length;
    activeSessionsCount.textContent = activeCount
        ? `${activeCount} active`
        : "No active sessions";

    if (!sessions.length) {
        const profileClass = profile.className || profile.classId || profile.class || profile.department;
        const missingDetails = !profileClass || profile.semester == null || !profile.division;

        attendanceSessions.innerHTML = missingDetails
            ? '<div class="empty-state"><strong>Your academic details are incomplete.</strong>Update class, semester and division in My Profile or ask an administrator to update your student account.</div>'
            : '<div class="empty-state"><strong>No attendance sessions available.</strong>Faculty can start a session for your class.</div>';
        return;
    }

    sessions.slice(0, 10).forEach(sessionData => {
        const isActive = sessionData.status === "active";
        const card = document.createElement("article");
        card.className = "subject-card";

        const badge = document.createElement("span");
        badge.className = `session-badge ${isActive ? "active" : "ended"}`;
        badge.textContent = isActive ? "Active" : "Completed";

        const title = document.createElement("h3");
        title.textContent = sessionData.subjectName || sessionData.subject || "Attendance session";

        const details = document.createElement("p");
        details.className = "subject-meta";
        details.textContent =
            `${sessionData.facultyName || "Faculty"} · ${sessionData.date || "Date unavailable"} · ` +
            `${formatSessionTime(sessionData.startTime || sessionData.startedAt)}`;

        card.append(badge, title, details);
        attendanceSessions.appendChild(card);
    });
}

function getSessionTimestamp(value) {
    if (value?.toMillis) return value.toMillis();
    const timestamp = new Date(value || 0).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatSessionTime(value) {
    if (value?.toDate) return value.toDate().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "Time unavailable"
        : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function listenForAttendanceRecords(studentUid, profile) {
    unsubscribeAttendance?.();

    const attendanceQuery = query(
        collection(db, "attendance"),
        where("studentId", "==", studentUid)
    );

    unsubscribeAttendance = onSnapshot(
        attendanceQuery,
        snapshot => {
            const records = snapshot.docs.map(attendanceDocument => ({
                id: attendanceDocument.id,
                ...attendanceDocument.data()
            }));

            calculateAttendance(records);
            renderAttendanceAlert(records, profile);
            displaySubjectAttendance(records);
            displayRecentAttendance(records);
            setDashboardState("");
        },
        error => {
            console.error("Student attendance listener error:", error);
            setDashboardState(getDashboardErrorMessage(error), true);
            renderLoadError();
        }
    );
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
