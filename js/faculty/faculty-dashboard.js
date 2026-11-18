import { requireRole, logout } from "../auth.js";
import { db } from "../../firebase-config.js";
import {
    collection,
    doc,
    getDocs,
    query,
    where,
    onSnapshot,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const session = await requireRole("faculty");
document.querySelector("[data-name]").textContent = session.profile.name || "Faculty";
document.querySelector("[data-logout]").addEventListener("click", async (event) => {
    event.preventDefault();
    await logout();
});

const assignedClassesCount = document.getElementById("assignedClassesCount");
const totalStudentsCount = document.getElementById("totalStudentsCount");
const todayAttendanceCount = document.getElementById("todayAttendanceCount");
const recentActivityCount = document.getElementById("recentActivityCount");
const activeSessionStatus = document.getElementById("activeSessionStatus");
const endDashboardSessionButton = document.getElementById("endDashboardSessionButton");
const recentAttendanceActivity = document.getElementById("recentAttendanceActivity");

let dashboardActiveSession = null;
let unsubscribeSessions = null;
let unsubscribeAttendance = null;

const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

const sessionsQuery = query(
    collection(db, "sessions"),
    where("facultyId", "==", session.user.uid)
);

unsubscribeSessions = onSnapshot(
    sessionsQuery,
    snapshot => {
        dashboardActiveSession = snapshot.docs
            .map(sessionDocument => ({
                id: sessionDocument.id,
                ...sessionDocument.data()
            }))
            .find(sessionData => sessionData.status === "active") || null;

        if (!dashboardActiveSession) {
            activeSessionStatus.textContent = "No active session.";
            endDashboardSessionButton.hidden = true;
            return;
        }

        activeSessionStatus.textContent =
            `${dashboardActiveSession.subjectName || dashboardActiveSession.subject} · ` +
            `${dashboardActiveSession.className || dashboardActiveSession.classId || "Class"} · ` +
            `Started ${formatTime(dashboardActiveSession.startTime || dashboardActiveSession.startedAt)}`;
        endDashboardSessionButton.hidden = false;
    },
    error => {
        console.error("Faculty active session listener error:", error);
        activeSessionStatus.textContent = "Unable to load the active session.";
    }
);

const attendanceQuery = query(
    collection(db, "attendance"),
    where("facultyId", "==", session.user.uid),
    where("date", "==", today)
);

unsubscribeAttendance = onSnapshot(
    attendanceQuery,
    snapshot => {
        const records = snapshot.docs
            .map(attendanceDocument => ({
                id: attendanceDocument.id,
                ...attendanceDocument.data()
            }))
        todayAttendanceCount.textContent = records.length;
        recentActivityCount.textContent = records.length;

        if (!records.length) {
            recentAttendanceActivity.textContent =
                "No attendance activity recorded today.";
            return;
        }

        const newest = [...records]
            .sort((left, right) =>
                getTimestamp(right.scannedAt || right.createdAt) -
                getTimestamp(left.scannedAt || left.createdAt))[0];

        recentAttendanceActivity.textContent =
            `${newest.studentName || newest.studentCode || "Student"} · ` +
            `${newest.subject || "Subject"} · ${newest.time || "Time unavailable"}`;
    },
    error => {
        console.error("Faculty attendance dashboard listener error:", error);
        todayAttendanceCount.textContent = "--";
        recentAttendanceActivity.textContent = "Unable to load today's attendance.";
    }
);

endDashboardSessionButton?.addEventListener("click", async () => {
    if (!dashboardActiveSession) return;
    endDashboardSessionButton.disabled = true;

    try {
        await updateDoc(doc(db, "sessions", dashboardActiveSession.id), {
            status: "completed",
            endTime: serverTimestamp(),
            endedAt: serverTimestamp()
        });
        showDashboardToast("Attendance session ended.", "success");
    } catch (error) {
        console.error("Dashboard end session failed:", error);
        showDashboardToast("Unable to end the session.", "error");
    } finally {
        endDashboardSessionButton.disabled = false;
    }
});

function getTimestamp(value) {
    if (value?.toMillis) return value.toMillis();
    const timestamp = new Date(value || 0).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatTime(value) {
    if (value?.toDate) {
        return value.toDate().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        });
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "Unknown time"
        : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function showDashboardToast(message, type) {
    if (typeof window.showToast === "function") {
        window.showToast(message, type);
    }
}

loadFacultyTotals();

async function loadFacultyTotals() {
    try {
        const [sessionsSnapshot, usersSnapshot] = await Promise.all([
            getDocs(query(collection(db, "sessions"), where("facultyId", "==", session.user.uid))),
            getDocs(query(collection(db, "users"), where("role", "==", "student")))
        ]);

        const classNames = new Set(
            sessionsSnapshot.docs
                .map(sessionDocument => {
                    const data = sessionDocument.data();
                    return data.className || data.classId || data.class || "";
                })
                .filter(Boolean)
        );

        assignedClassesCount.textContent = classNames.size;

        const matchingStudents = usersSnapshot.docs.filter(studentDocument => {
            const student = studentDocument.data();
            const studentClass = student.className || student.classId || student.class || student.department || "";
            return classNames.has(studentClass);
        });

        totalStudentsCount.textContent = matchingStudents.length;
    } catch (error) {
        console.error("Faculty dashboard totals error:", error);
        assignedClassesCount.textContent = "--";
        totalStudentsCount.textContent = "--";
    }
}

window.addEventListener("pagehide", () => {
    unsubscribeSessions?.();
    unsubscribeAttendance?.();
}, { once: true });
