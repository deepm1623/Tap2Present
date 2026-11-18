import { requireRole, logout } from "../auth.js";
import { db } from "../../firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const session = await requireRole("admin");
document.querySelector("[data-logout]").addEventListener("click", async (event) => {
    event.preventDefault();
    await logout();
});

const dashboardMessage = document.getElementById("dashboardMessage");
const totalStudentsCount = document.getElementById("totalStudentsCount");
const totalFacultyCount = document.getElementById("totalFacultyCount");
const totalClassesCount = document.getElementById("totalClassesCount");
const pendingApprovalsCount = document.getElementById("pendingApprovalsCount");
const attendanceOverview = document.getElementById("attendanceOverview");

try {
    const [usersSnapshot, attendanceSnapshot] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "attendance"))
    ]);

    const users = usersSnapshot.docs.map(documentSnapshot => documentSnapshot.data());
    const students = users.filter(user => user.role === "student");
    const faculty = users.filter(user => user.role === "faculty");
    const pending = users.filter(user => String(user.status || "").toLowerCase() !== "active");
    const classes = new Set(
        students
            .map(student => student.className || student.classId || student.department)
            .filter(Boolean)
    );

    totalStudentsCount.textContent = students.length;
    totalFacultyCount.textContent = faculty.length;
    totalClassesCount.textContent = classes.size;
    pendingApprovalsCount.textContent = pending.length;

    const presentCount = attendanceSnapshot.docs.filter(documentSnapshot => {
        const record = documentSnapshot.data();
        const status = String(record.attendanceStatus || record.status || "").toLowerCase();
        return status === "present";
    }).length;

    attendanceOverview.textContent = attendanceSnapshot.empty
        ? "No attendance records have been stored yet."
        : `${presentCount} present marks across ${attendanceSnapshot.size} stored attendance documents.`;

    dashboardMessage.textContent = `Signed in as ${session.profile.name || "Administrator"}.`;
} catch (error) {
    console.error("Admin dashboard load error:", error);
    dashboardMessage.textContent = error.code === "permission-denied"
        ? "Firestore permission error. This admin account cannot read institution records."
        : "Unable to load dashboard totals.";
    attendanceOverview.textContent = "Attendance overview is unavailable.";
}
