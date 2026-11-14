
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
const studentInitial = document.getElementById("studentInitial");

const totalClasses = document.getElementById("totalClasses");
const presentClasses = document.getElementById("presentClasses");
const absentClasses = document.getElementById("absentClasses");
const attendancePercentage = document.getElementById("attendancePercentage");

const attendanceTableBody = document.getElementById("attendanceTableBody");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");

const pageMessage = document.getElementById("pageMessage");
const recordCount = document.getElementById("recordCount");

const logoutButton = document.getElementById("logoutButton");

let allRecords = [];

// Logout
logoutButton.addEventListener("click", async function () {
    try {
        await signOut(auth);
        window.location.href = "student-login.html";
    } catch (error) {
        console.error("Logout error:", error);
        alert("Unable to logout. Please try again.");
    }
});

// Check login and load attendance
onAuthStateChanged(auth, async function (user) {

    if (!user) {
        window.location.href = "student-login.html";
        return;
    }

    try {
        pageMessage.textContent = "Checking student account...";

        // Get student profile
        const userRef = doc(db, "users", user.uid);
        const userSnapshot = await getDoc(userRef);

        if (!userSnapshot.exists()) {
            await signOut(auth);
            window.location.href = "student-login.html";
            return;
        }

        const userData = userSnapshot.data();

        if (userData.role !== "student") {
            await signOut(auth);
            window.location.href = "../login.html";
            return;
        }

        if (userData.status !== "active") {
            pageMessage.textContent =
                "Your account is waiting for approval.";

            await signOut(auth);
            return;
        }

        // Display student name
        const name = userData.name || "Student";

        studentName.textContent = name;
        studentInitial.textContent = name.charAt(0).toUpperCase();

        // Get this student's attendance
        pageMessage.textContent = "Loading attendance records...";

        const attendanceQuery = query(
            collection(db, "attendance"),
            where("studentId", "==", user.uid)
        );

        const attendanceSnapshot = await getDocs(attendanceQuery);

        allRecords = [];

        attendanceSnapshot.forEach(function (document) {
            allRecords.push({
                id: document.id,
                ...document.data()
            });
        });

        // Sort newest first
        allRecords.sort(function (a, b) {
            return getRecordDate(b) - getRecordDate(a);
        });

        calculateStatistics();
        displayRecords(allRecords);

        pageMessage.textContent = "";

    } catch (error) {

        console.error("Attendance history error:", error);

        if (error.code === "permission-denied") {
            pageMessage.textContent =
                "Database permission denied. Please check Firestore rules.";
        } else {
            pageMessage.textContent =
                "Unable to load attendance history. Please try again.";
        }
    }
});

// Convert record date and time into a sortable date
function getRecordDate(record) {

    const date = record.date || "";
    const time = record.time || "00:00";

    return new Date(date + " " + time).getTime() || 0;
}

// Calculate statistics
function calculateStatistics() {

    let present = 0;
    let absent = 0;

    allRecords.forEach(function (record) {

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

    totalClasses.textContent = total;
    presentClasses.textContent = present;
    absentClasses.textContent = absent;
    attendancePercentage.textContent = percentage + "%";
}

// Search and filter
searchInput.addEventListener("input", applyFilters);
statusFilter.addEventListener("change", applyFilters);

function applyFilters() {

    const searchValue = searchInput.value.trim().toLowerCase();
    const selectedStatus = statusFilter.value;

    const filteredRecords = allRecords.filter(function (record) {

        const subject = String(record.subject || "").toLowerCase();
        const status = String(record.status || "").toLowerCase();

        const matchesSubject = subject.includes(searchValue);

        const matchesStatus =
            selectedStatus === "all" || status === selectedStatus;

        return matchesSubject && matchesStatus;
    });

    displayRecords(filteredRecords);
}

// Display records
function displayRecords(records) {

    attendanceTableBody.innerHTML = "";

    recordCount.textContent =
        records.length + (records.length === 1 ? " record" : " records");

    if (records.length === 0) {

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 4;
        cell.className = "empty-message";
        cell.textContent = allRecords.length === 0
            ? "No attendance records found."
            : "No matching attendance records.";

        row.appendChild(cell);
        attendanceTableBody.appendChild(row);

        return;
    }

    records.forEach(function (record) {

        const row = document.createElement("tr");

        const subjectCell = document.createElement("td");
        subjectCell.textContent = record.subject || "Unknown Subject";

        const dateCell = document.createElement("td");
        dateCell.textContent = record.date || "Not available";

        const timeCell = document.createElement("td");
        timeCell.textContent = record.time || "Not available";

        const statusCell = document.createElement("td");

        const status = String(record.status || "").toLowerCase();

        const statusBadge = document.createElement("span");
        statusBadge.className = "status-badge";

        if (status === "present") {
            statusBadge.classList.add("status-present");
            statusBadge.textContent = "Present";
        } else if (status === "absent") {
            statusBadge.classList.add("status-absent");
            statusBadge.textContent = "Absent";
        } else {
            statusBadge.textContent = "Unknown";
        }

        statusCell.appendChild(statusBadge);

        row.appendChild(subjectCell);
        row.appendChild(dateCell);
        row.appendChild(timeCell);
        row.appendChild(statusCell);

        attendanceTableBody.appendChild(row);
    });
}
