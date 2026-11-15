
import { auth, db } from "../../firebase-config.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// HTML elements
const studentName = document.getElementById("studentName");
const headerStudentName = document.getElementById("headerStudentName");
const studentInitial = document.getElementById("studentInitial");

const attendancePercentage = document.getElementById("attendancePercentage");
const totalClasses = document.getElementById("totalClasses");
const presentClasses = document.getElementById("presentClasses");
const absentClasses = document.getElementById("absentClasses");

const recentAttendance = document.getElementById("recentAttendance");
const dashboardMessage = document.getElementById("dashboardMessage");

const logoutButton = document.getElementById("logoutButton");

// Logout
logoutButton.addEventListener("click", async function () {
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
        console.error("Logout error:", error);
        window.showToast("Unable to logout. Please try again.", "error", "Logout failed");
    }
});

// Check authentication
onAuthStateChanged(auth, async function (user) {

    if (!user) {
        window.location.href = "student-login.html";
        return;
    }

    try {
        dashboardMessage.textContent = "Loading your profile...";

        // Get student profile from Firestore
        const userRef = doc(db, "users", user.uid);
        const userSnapshot = await getDoc(userRef);

        if (!userSnapshot.exists()) {
            await signOut(auth);
            window.location.href = "student/student-login.html";
            return;
        }

        const userData = userSnapshot.data();

        // Verify student role
        if (userData.role !== "student") {
            await signOut(auth);
            window.location.href = "../login.html";
            return;
        }

        // Verify account status
        if (userData.status !== "active") {
            dashboardMessage.textContent =
                "Your account is waiting for approval.";

            await signOut(auth);
            return;
        }

        // Display student information
        const name = userData.name || "Student";

        studentName.textContent = name;
        headerStudentName.textContent = name;
        studentInitial.textContent = name.charAt(0).toUpperCase();

        dashboardMessage.textContent = "Loading attendance records...";

        // Get attendance records belonging to this student
        const attendanceQuery = query(
            collection(db, "attendance"),
            where("studentId", "==", user.uid)
        );

        const attendanceSnapshot = await getDocs(attendanceQuery);

        const records = [];

        attendanceSnapshot.forEach(function (document) {
            records.push({
                id: document.id,
                ...document.data()
            });
        });

        // Calculate attendance statistics
        calculateAttendance(records);

        // Display recent attendance
        displayRecentAttendance(records);

        dashboardMessage.textContent = "";

    } catch (error) {

        console.error("Dashboard error:", error);

        if (error.code === "permission-denied") {
            dashboardMessage.textContent =
                "Database permission denied. Please check Firestore rules.";
        } else {
            dashboardMessage.textContent =
                "Unable to load dashboard data. Please try again.";
        }
    }
});

// Calculate attendance percentage and totals
function calculateAttendance(records) {

    let present = 0;
    let absent = 0;

    records.forEach(function (record) {

        const status = String(record.status || "").toLowerCase();

        if (status === "present") {
            present++;
        } else if (status === "absent") {
            absent++;
        }

    });

    const total = present + absent;

    let percentage = 0;

    if (total > 0) {
        percentage = Math.round((present / total) * 100);
    }

    attendancePercentage.textContent = percentage + "%";
    totalClasses.textContent = total;
    presentClasses.textContent = present;
    absentClasses.textContent = absent;
}

// Display recent attendance records
function displayRecentAttendance(records) {

    recentAttendance.innerHTML = "";

    // Sort records by date and time, newest first
    records.sort(function (a, b) {

        const dateA = new Date(
            (a.date || "") + " " + (a.time || "00:00")
        ).getTime();

        const dateB = new Date(
            (b.date || "") + " " + (b.time || "00:00")
        ).getTime();

        return dateB - dateA;
    });

    const latestRecords = records.slice(0, 5);

    if (latestRecords.length === 0) {

        recentAttendance.innerHTML = `
            <div class="empty-history">
                <h3>No attendance records yet</h3>
                <p>Your attendance history will appear here.</p>
            </div>
        `;

        return;
    }

    latestRecords.forEach(function (record) {

        const subject = record.subject || "Unknown Subject";
        const date = record.date || "Not available";
        const time = record.time || "Not available";

        const status = String(record.status || "").toLowerCase();

        let statusClass = "";
        let statusText = "Unknown";

        if (status === "present") {
            statusClass = "status-present";
            statusText = "Present";
        } else if (status === "absent") {
            statusClass = "status-absent";
            statusText = "Absent";
        }

        const row = document.createElement("div");
        row.className = "history-row";

        const subjectElement = document.createElement("span");
        subjectElement.textContent = subject;

        const dateElement = document.createElement("span");
        dateElement.textContent = date;

        const timeElement = document.createElement("span");
        timeElement.textContent = time;

        const statusElement = document.createElement("span");
        statusElement.className = "status-badge " + statusClass;
        statusElement.textContent = statusText;

        row.appendChild(subjectElement);
        row.appendChild(dateElement);
        row.appendChild(timeElement);
        row.appendChild(statusElement);

        recentAttendance.appendChild(row);
    });
}
