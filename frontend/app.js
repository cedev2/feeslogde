/* ===================================================================
   FeesLedger — Frontend Application (Node.js + MongoDB Backend)
   ===================================================================
   This file preserves ALL existing UI/rendering.
   Data layer uses Node.js/Express API calls with MongoDB.
   =================================================================== */

// ---- STATE ----
let db = null;
let session = null;
let page = "dashboard",
  term = "Term 1",
  year = "2026–2027",
  search = "",
  statusFilter = "all",
  classFilter = "all",
  historySearch = "",
  historyYear = "All Years",
  historyTerm = "All Terms",
  historyClass = "All Classes",
  saveFilesSearch = "";
let saveFilesPending = [];
const showCount = { students: 10, parents: 10, files: 10, users: 10, payments: 10, classes: 10, trash: 10 };
const LOAD_STEP = 10;
function loadMoreBtn(key, total) {
  const shown = showCount[key] || LOAD_STEP;
  if ((total || 0) <= shown) return "";
  return `<div class="controls" style="justify-content:center;margin-top:12px"><button class="btn primary" onclick="showCount['${key}']=${shown + LOAD_STEP};render()">Load More (${total - shown} remaining)</button></div>`;
}
const FILE_SIZE_LIMITS = { pdf: 10 * 1024 * 1024, doc: 10 * 1024 * 1024, xls: 10 * 1024 * 1024, image: 5 * 1024 * 1024, other: 10 * 1024 * 1024 };
const MAX_FILES_PER_USER = 100, MAX_STORAGE_PER_USER = 500 * 1024 * 1024;
const roles = { SUPER_ADMIN: "super_admin", SCHOOL_ADMIN: "school_admin", ACCOUNTANT: "accountant" };

// ---- UTILITY FUNCTIONS ----
function uid(p = "id") { return p + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function money(n) { return Number(n || 0).toLocaleString() + " FRW"; }
function pct(p) { return Math.max(0, Math.min(100, Number(p || 0))).toFixed(1); }
function toast(m) {
  let t = document.getElementById("toast");
  t.textContent = m;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2800);
}
function can(action) {
  if (!session) return false;
  if (session.role === roles.SUPER_ADMIN) return true;
  if (session.role === roles.SCHOOL_ADMIN) return ["classes", "access", "settings", "reports", "messages", "students", "payments", "parents", "files", "users"].includes(action);
  if (session.role === roles.ACCOUNTANT) return ["students", "payments", "reports", "messages", "files"].includes(action);
  return false;
}

// ---- HELPER FUNCTIONS (use db object like before) ----
function activeStudents() { return (db.students || []).filter(s => s.year === year || !s.year); }
function academicConfig(y = year) {
  if (!db.academics) db.academics = {};
  if (!db.academics[y]) db.academics[y] = { terms: [{ name: "Term 1", start: "", end: "" }, { name: "Term 2", start: "", end: "" }, { name: "Term 3", start: "", end: "" }] };
  return db.academics[y];
}
function termNames(y = year) { return academicConfig(y).terms.map(t => t.name).filter(Boolean); }
function ensureAcademicData() {
  if (!db.academics) db.academics = {};
  (db.years || []).forEach(y => academicConfig(y));
  if (!db.years?.length) { db.years = [year]; academicConfig(year); }
  let names = termNames(year);
  if (!names.includes(term) && term !== "All Terms") term = names[0] || "Term 1";
}
function classStudents(c) { return activeStudents().filter(s => s.classId === c.id || s.class_id === c.id); }
function totalFeesFor(s) { let c = db.classes.find(x => x.id === (s.classId || s.class_id)); return Number(s.unitFee ?? s.unit_fee ?? c?.unit_fee ?? c?.unitFee ?? 0); }
function paymentsFor(s) { return (db.payments || []).filter(p => (p.studentId || p.student_id) === (s.id) && (term === "All Terms" || p.term === term || p.term_name === term)); }
function paidFor(s) { return paymentsFor(s).reduce((a, p) => a + Number(p.amount || 0), 0); }
function statusOf(s) { let f = totalFeesFor(s), p = paidFor(s); if (f > 0 && p >= f) return "paid"; if (p > 0) return "partial"; return "unpaid"; }
function balanceOf(s) { return Math.max(0, totalFeesFor(s) - paidFor(s)); }
function percentageOf(s) { let f = totalFeesFor(s); return f ? Math.min(100, paidFor(s) / f * 100) : 0; }
function log(action, details = "") { /* logged server-side now */ }
function save() { /* no-op: data saved via API */ }

// ---- NORMALIZE API DATA ----
function normalizeStudents(students) {
  return students.map(s => ({
    id: s.id, name: s.name, studentId: s.student_id, classId: s.class_id,
    parentName: s.parent_name || "", parentEmail: s.parent_email || "",
    parentPhone: s.parent_phone || "", parent_phone: s.parent_phone || "",
    gender: s.gender, photo: s.photo, year: s.year_name || year,
    term: s.term_name || "Term 1", unitFee: s.unit_fee,
    unit_fee: s.unit_fee, class_id: s.class_id, class_name: s.class_name,
    total_paid: s.total_paid || 0, payment_status: s.payment_status
  }));
}

function normalizePayments(payments) {
  return payments.map(p => ({
    id: p.id, studentId: p.student_id, studentName: p.student_name,
    studentIdText: p.student_id_text, classId: p.class_id, className: p.class_name,
    amount: p.amount, term: p.term_name || term, year: year,
    user: p.recorded_by_email || "", method: p.payment_method || "Cash",
    date: p.payment_date, receiptNo: p.receipt_number
  }));
}

function normalizeClasses(classes) {
  return classes.map(c => ({
    id: c.id, name: c.name, unitFee: c.unit_fee, unit_fee: c.unit_fee,
    year: c.year_name || year
  }));
}

// ---- INIT ----
async function init() {
  try {
    // Try loading from API
    const me = await apiGet('/auth/me');
    if (me.data) {
      session = me.data;
      if (session.role === roles.SUPER_ADMIN) {
        await loadSuperAdminData();
        render();
      } else {
        await loadAllData();
        render();
      }
      return;
    }
  } catch (e) {
    // Not logged in
  }
  renderLogin();
}

async function loadAllData() {
  try {
    const [schoolRes, classesRes, studentsRes, paymentsRes, parentsRes, filesRes, usersRes, trashRes] = await Promise.all([
      apiGet('/settings/school'),
      apiGet('/classes/list?year=' + encodeURIComponent(year)),
      apiGet('/students/list?year=' + encodeURIComponent(year)),
      apiGet('/payments/list?year=' + encodeURIComponent(year) + '&term=' + encodeURIComponent(term)),
      apiGet('/parents/list'),
      apiGet('/files/list'),
      apiGet('/settings/users-list'),
      apiGet('/trash/list'),
    ]);

    db = {
      school: schoolRes.data?.school || { name: "School", logo: "", email: "", phone: "" },
      classes: normalizeClasses(classesRes.data?.classes || []),
      students: normalizeStudents(studentsRes.data?.students || []),
      payments: normalizePayments(paymentsRes.data?.payments || []),
      history: [], messages: [], templates: [], users: usersRes.data?.users || [],
      savedFiles: filesRes.data?.files || [],
      years: [year], parents: parentsRes.data?.parents || [], academics: {},
      trash: trashRes.data?.items || [], trashTTL: trashRes.data?.ttl_days || 5,
      schools: []
    };

    ensureAcademicData();
  } catch (e) {
    console.error("Failed to load data:", e);
    db = { school: { name: "School" }, classes: [], students: [], payments: [], history: [], messages: [], years: [year], parents: [], academics: {}, schools: [], users: [], savedFiles: [], trash: [], trashTTL: 5 };
  }
}

// ---- RENDER ----
function render() {
  if (!session) { renderLogin(); return; }
  if (session.role === roles.SUPER_ADMIN) {
    renderSuperAdmin();
    return;
  }
  document.getElementById("root").innerHTML = `<div class="app">
 <aside><div class="logo">Fees<span>Ledger</span></div><div class="nav">
 ${nav("dashboard", "Dashboard")}
 ${nav("classes", "Classes")}
 ${nav("students", "Students")}
 ${nav("parents", "Parents")}
 ${nav("payments", "Payments")}
 ${nav("messages", "Email Messages")}
 ${nav("history", "History")}
 ${nav("reports", "Reports")}
 ${session.role !== roles.ACCOUNTANT ? nav("users", "Users") : ""}
  ${nav("savefiles", "Save Files")}
  ${nav("settings", "Settings")}
  ${nav("trash", `Trash${db?.trash?.length ? ` (${db.trash.length})` : ""}`)}
  </div><div><button class="btn" style="width:100%" onclick="sidebarClose();logout()">Logout</button></div></aside>
 <div class="sidebar-overlay" onclick="sidebarClose()"></div>
 <main><div class="top"><div><button class="sidebar-toggle" onclick="sidebarToggle(event)">☰</button><div><h1>${title()}</h1><div class="muted">${esc(db?.school?.name || "School")} · ${esc(session.role)}</div></div></div><div class="controls">${session?.role === roles.SCHOOL_ADMIN ? `<button class="btn" onclick="contactSuperAdmin()">✉️ Contact Super Admin</button>` : ""}<select onchange="year=this.value;loadAndRender()"><option>${esc(year)}</option></select><select onchange="term=this.value;render()"><option>${esc(term)}</option><option ${term === "All Terms" ? "selected" : ""}>All Terms</option></select></div></div>${page === "dashboard" ? dashboard() : page === "classes" ? classesPage() : page === "students" ? studentsPage() : page === "parents" ? parentsPage() : page === "payments" ? paymentsPage() : page === "messages" ? messagesPage() : page === "history" ? historyPage() : page === "reports" ? reportsPage() : page === "users" ? usersPage() : page === "savefiles" ? savedFilesPage() : page === "trash" ? trashPage() : settingsPage()}</main></div>`;
}

async function loadAndRender() {
  await loadAllData();
  render();
}

let superSchools = [];
let superPending = [];
let superRejected = [];

async function loadSuperAdminData() {
  try {
    const res = await apiGet('/schools/list');
    superSchools = res.data?.schools || [];
    superPending = res.data?.pending_registrations || [];
    superRejected = res.data?.rejected_registrations || [];
  } catch (e) {
    superSchools = [];
    superPending = [];
    superRejected = [];
  }
}

function renderSuperAdmin() {
  const spage = ["schools", "schoolStatus", "schoolMessages", "settings", "trash"].includes(page) ? page : "dashboard";
  document.getElementById("root").innerHTML = `<div class="app">
   <aside><div class="logo">Fees<span>Ledger</span></div><div class="nav">
   ${nav("dashboard", "Dashboard")}
   ${nav("schools", "School Emails")}
   ${nav("schoolStatus", "School Status")}
   ${nav("schoolMessages", "Compose School Email")}
   ${nav("settings", "Settings")}
   ${nav("trash", `Trash${superRejected?.length ? ` (${superRejected.length})` : ""}`)}
   </div><div><button class="btn" style="width:100%" onclick="sidebarClose();logout()">Logout</button></div></aside>
   <div class="sidebar-overlay" onclick="sidebarClose()"></div>
   <main><div class="top"><div><button class="sidebar-toggle" onclick="sidebarToggle(event)">☰</button><div><h1>${superTitle(spage)}</h1><div class="muted">FeesLedger · Super Admin</div></div></div></div>${spage === "schools" ? superSchoolsPage() : spage === "schoolStatus" ? schoolStatusPage() : spage === "schoolMessages" ? composeSchoolEmailPage() : spage === "settings" ? superSettingsPage() : spage === "trash" ? superTrashPage() : superAdminDashboard()}</main></div>`;
}

function superTitle(p) { return ({ dashboard: "Super Admin Dashboard", schools: "School Emails", schoolStatus: "School Status", schoolMessages: "Compose School Email", settings: "Settings", trash: "Trash" })[p] || "Super Admin Dashboard"; }
function nav(p, t) { return `<button class="${page === p ? "active" : ""}" onclick="page='${p}';sidebarClose();render()">${t}</button>`; }
function sidebarToggle(e) {
  if (e) e.stopPropagation();
  const app = document.querySelector('.app');
  app?.classList.toggle('sidebar-open');
}
function sidebarClose() {
  document.querySelector('.app')?.classList.remove('sidebar-open');
}
function title() { return ({ dashboard: "Dashboard", classes: "Classes & Fees", students: "Students", parents: "Parents", payments: "Payments", messages: "Email Center", history: "History", reports: "Reports", users: "Users", savefiles: "Save Files", settings: "Settings", trash: "Trash" })[page]; }

function schoolStatusLabel(s) {
  if (s.status === "pending_delete") {
    const left = Math.max(0, 10 - Math.floor((Date.now() - new Date(s.delete_requested_at || s.status_since).getTime()) / (24 * 60 * 60 * 1000)));
    return `Pending Delete · ${left} day${left === 1 ? "" : "s"} left`;
  }
  if (s.status === "paid") {
    if (!s.paid_until) return "Paid";
    const left = Math.max(0, Math.ceil((new Date(s.paid_until).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    return `Paid · ${left} day${left === 1 ? "" : "s"} left`;
  }
  if (s.status === "suspended") return "Suspended";
  if (s.status === "deleted") return "Deleted";
  if (s.status === "active") return "Active";
  return "Unpaid";
}
function schoolBadgeClass(s) {
  if (s.status === "paid" || s.status === "active") return "paid";
  if (s.status === "pending_delete") return "partial";
  return "unpaid";
}

function superAdminDashboard() {
  const active = superSchools.filter(s => s.status === "active" || s.status === "paid").length;
  const unpaid = superSchools.filter(s => s.status === "unpaid" || s.status === "suspended").length;
  const pending = superSchools.filter(s => s.status === "pending_delete").length;
  return `<div class="grid">
  <div class="card"><div class="muted">Schools</div><div class="metric">${superSchools.length}</div></div>
  <div class="card"><div class="muted">Active / Paid</div><div class="metric">${active}</div></div>
  <div class="card"><div class="muted">Unpaid / Suspended</div><div class="metric">${unpaid}</div></div>
  <div class="card"><div class="muted">Pending Deletion</div><div class="metric">${pending}</div></div>
 </div>
 <div class="card" style="margin-top:16px"><h2>Super Admin Overview</h2><p class="muted">Manage school subscriptions and communication from one place.</p>
 <div class="controls dashboard-actions"><button class="btn primary" onclick="page='schools';render()">Manage Schools</button><button class="btn" onclick="page='schoolMessages';render()">Compose School Email</button><button class="btn" onclick="page='settings';render()">Settings</button></div></div>`;
}

function superSchoolsPage() {
  const q = (window.schoolListSearch || "").toLowerCase();
  const rows = superSchools.filter(s => (`${s.name} ${s.admin_name} ${s.admin_email} ${schoolStatusLabel(s)}`).toLowerCase().includes(q));
  const pend = (superPending || []).filter(p => (`${p.full_name} ${p.email} ${p.school_name}`).toLowerCase().includes(q));
  return `<div class="card"><div class="controls" style="justify-content:space-between"><div><h2 style="margin:0">Schools & School Emails</h2><p class="muted">Manage school status, payment state and deletion requests.</p></div><input placeholder="Search school, admin or email…" value="${esc(window.schoolListSearch || "")}" oninput="window.schoolListSearch=this.value;render()"></div>
  ${pend.length ? `<div style="background:#fffbeb;border:1px solid #f59e0b33;border-radius:10px;padding:14px;margin:14px 0"><h3 style="margin:0 0 8px;color:#b45309">Pending Approvals (${pend.length})</h3><div class="tablewrap"><table><thead><tr><th>School</th><th>Admin</th><th>Email</th><th>Registered</th><th>Actions</th></tr></thead><tbody>
  ${pend.map(p => `<tr><td><b>${esc(p.school_name || "—")}</b></td><td>${esc(p.full_name || "—")}</td><td>${esc(p.email || "—")}</td><td class="muted">${esc((p.created_at || "").slice(0, 10))}</td><td><div class="controls"><button class="btn success" onclick="saApproveRegistration('${p.id}')">Approve</button><button class="btn danger" onclick="saRejectRegistration('${p.id}')">Reject</button></div></td></tr>`).join("")}
  </tbody></table></div></div>` : ""}
  ${superRejected.length ? `<div style="background:#fef2f2;border:1px solid #ef444433;border-radius:10px;padding:14px;margin:14px 0"><h3 style="margin:0 0 8px;color:#b91c1c">Rejected (${superRejected.length})</h3><div class="tablewrap"><table><thead><tr><th>School</th><th>Admin</th><th>Email</th><th>Rejected</th><th>Actions</th></tr></thead><tbody>
  ${superRejected.map(r => `<tr><td><b>${esc(r.school_name || "—")}</b></td><td>${esc(r.full_name || "—")}</td><td>${esc(r.email || "—")}</td><td class="muted">${esc((r.deleted_at || "").slice(0, 10))}</td><td><div class="controls"><button class="btn success" onclick="saRestoreRejected('${r.trash_id}')">Restore</button><button class="btn danger" onclick="saPermanentlyDeleteRejected('${r.trash_id}')">Delete Forever</button></div></td></tr>`).join("")}
  </tbody></table></div></div>` : ""}
  <div class="tablewrap"><table><thead><tr><th>School Admin</th><th>School</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead><tbody>
 ${rows.map(s => `<tr><td><b>${esc(s.admin_name || "—")}</b></td><td>${esc(s.name || "—")}</td><td>${esc(s.admin_email || "—")}</td><td><span class="badge ${schoolBadgeClass(s)}">${esc(schoolStatusLabel(s))}</span></td><td class="actions no-print">
 ${s.status !== "deleted" ? `<button class="btn" onclick="saSetSchoolStatus('${s.id}','active')">Active</button><button class="btn warning" onclick="saSetSchoolStatus('${s.id}','suspended')">Suspend</button><button class="btn danger" onclick="saRequestSchoolDelete('${s.id}')">Delete</button><button class="btn primary" onclick="saContactSchool('${s.id}')">Contact</button><button class="btn success" onclick="saMarkSchoolPaid('${s.id}')">Paid</button><button class="btn danger" onclick="saMarkSchoolUnpaid('${s.id}')">Unpaid</button>` : `<button class="btn" disabled>Deleted</button>`}
 ${s.status === "pending_delete" ? `<button class="btn primary" onclick="saCancelSchoolDelete('${s.id}')">Restore</button>` : ""}
 </td></tr>`).join("") || `<tr><td colspan="5" class="muted">No schools found.</td></tr>`}
 </tbody></table></div></div>`;
}

function superTrashPage() {
  const items = (superRejected || []);
  return `<div class="card"><div class="controls" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
    <div><h2 style="margin:0">Trash</h2><p class="muted">Deleted or rejected schools are kept for 5 days, then permanently removed. You can restore them or delete forever.</p></div>
    <div class="controls">${items.length ? `<button class="btn danger" onclick="saEmptyAllRejected()">Empty Trash (${items.length})</button>` : ""}</div>
  </div></div>
  <div class="section tablewrap"><table><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Deleted</th><th class="no-print">Actions</th></tr></thead><tbody>
  ${items.map((t, i) => `<tr>
    <td>${i + 1}</td>
    <td><b>${esc(t.school_name || "Untitled")}</b> <span class="muted">(${esc(t.email || "—")})</span></td>
    <td><span class="badge">School</span></td>
    <td class="muted">${esc((t.deleted_at || "").slice(0, 10))}</td>
    <td class="actions no-print">
      <button class="btn success" onclick="saRestoreRejected('${t.trash_id}')">Restore</button>
      <button class="btn danger" onclick="saPermanentlyDeleteRejected('${t.trash_id}')">Delete Forever</button>
    </td></tr>`).join("") || `<tr><td colspan="5" class="muted">Trash is empty.</td></tr>`}
  </tbody></table></div>`;
}
async function saEmptyAllRejected() {
  const n = (superRejected || []).length;
  if (!n) return;
  if (!confirm(`Empty the entire Trash? ${n} rejected registration(s) will be permanently deleted. This cannot be undone.`)) return;
  for (const r of (superRejected || [])) {
    try { await apiPost('/trash/delete', { id: r.trash_id }); } catch (e) { toast(e.message); }
  }
  await loadSuperAdminData(); render(); toast("Trash emptied");
}

function schoolStatusPage() {
  const q = (window.schoolStatusSearch || "").toLowerCase();
  const rows = superSchools.filter(s => (`${s.name} ${s.admin_name} ${s.admin_email} ${schoolStatusLabel(s)}`).toLowerCase().includes(q));
  return `<div class="card"><h2>School Subscription Status</h2><p class="muted">Paid status automatically expires after 32 days and becomes Unpaid.</p><input placeholder="Search…" value="${esc(window.schoolStatusSearch || "")}" oninput="window.schoolStatusSearch=this.value;render()">
 <div class="tablewrap"><table><thead><tr><th>School Admin</th><th>School Name</th><th>Status</th><th>Subscription</th></tr></thead><tbody>
 ${rows.map(s => `<tr><td>${esc(s.admin_name || "—")}<br><span class="muted">${esc(s.admin_email || "")}</span></td><td>${esc(s.name || "—")}</td><td><span class="badge ${schoolBadgeClass(s)}">${esc(schoolStatusLabel(s))}</span></td><td><div class="controls"><button class="btn primary" onclick="saMarkSchoolPaid('${s.id}')">Paid</button><button class="btn danger" onclick="saMarkSchoolUnpaid('${s.id}')">Unpaid</button><button class="btn danger" onclick="saRequestSchoolDelete('${s.id}')">Delete</button></div></td></tr>`).join("") || `<tr><td colspan="4" class="muted">No schools found.</td></tr>`}
 </tbody></table></div></div>`;
}

function composeSchoolEmailPage() {
  const eligible = superSchools.filter(s => s.status !== "deleted");
  const paid = eligible.filter(s => s.status === "paid").length;
  const unpaid = eligible.filter(s => s.status === "unpaid" || s.status === "suspended" || s.status === "pending_delete").length;
  const all = eligible.length;
  return `<div class="card"><h2>Compose School Email</h2><p class="muted">Choose which schools should receive this message. The email app will open; nothing is sent automatically.</p>
 <div class="formgroup"><label>Send To</label><select id="schoolEmailAudience"><option value="all">All Schools (${all})</option><option value="paid">Paid Schools (${paid})</option><option value="unpaid">Unpaid Schools (${unpaid})</option></select></div>
 <div class="formgroup"><label>Subject</label><input id="schoolEmailSubject" value="FeesLedger School Account Message"></div>
 <div class="formgroup"><label>Message</label><textarea id="schoolEmailBody" rows="10">Dear School Administrator,

We are contacting you regarding your FeesLedger school account.

Thank you,
FeesLedger Administration</textarea></div>
 <div class="controls"><button class="btn" onclick="page='dashboard';render()">Cancel</button><button class="btn primary" onclick="openSchoolEmailApp()">Open Email App</button></div></div>`;
}

function openSchoolEmailApp() {
  const audience = document.getElementById("schoolEmailAudience").value;
  const subject = document.getElementById("schoolEmailSubject").value.trim();
  const body = document.getElementById("schoolEmailBody").value;
  if (!subject || !body) return toast("Subject and message are required.");
  let recipients = superSchools.filter(s => s.status !== "deleted" && s.admin_email && (
    audience === "all" || (audience === "paid" && s.status === "paid") || (audience === "unpaid" && (s.status === "unpaid" || s.status === "suspended"))
  )).map(s => s.admin_email);
  recipients = [...new Set(recipients)];
  if (!recipients.length) return toast("No matching school emails found.");
  const to = recipients[0], bcc = recipients.slice(1);
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` + (bcc.length ? `&bcc=${encodeURIComponent(bcc.join(","))}` : "");
  window.location.href = url;
  toast("School email draft opened in your email application.");
}

function superSettingsPage() {
  return `<div class="grid"><div class="card"><h2>Super Admin Settings</h2><p class="muted">Role: Super Admin</p><p class="muted">School management, subscription status and school email controls are available from the Super Admin workspace.</p></div>
 <div class="card"><h2>MFA & Backup Codes</h2><p class="muted">Create new authenticator setup and backup codes whenever needed.</p><button class="btn warning" onclick="setupMFA()">Create New MFA / Backup Codes</button></div>
 <div class="card"><h2>Change Password</h2><div class="formgroup"><label>Current Password</label><input id="curPwd" type="password"></div><div class="formgroup"><label>New Password</label><input id="newPwd" type="password" placeholder="At least 8 characters"></div><div class="formgroup"><label>Confirm New Password</label><input id="confirmPwd" type="password"></div><button class="btn primary" onclick="changePassword()">Update Password</button></div></div>`;
}

async function saSetSchoolStatus(id, status) {
  if (!confirm(`Confirm ${status} status?`)) return;
  try { await apiPost('/schools/update', { school_id: id, action: 'set_status', status }); await loadSuperAdminData(); render(); toast('Status updated.'); } catch (e) { toast(e.message); }
}
async function saRequestSchoolDelete(id) {
  if (!confirm('Delete this school? It will move to Trash and be recoverable for 10 days (or until permanently deleted).')) return;
  try { await apiPost('/schools/update', { school_id: id, action: 'request_delete' }); await loadSuperAdminData(); render(); toast('School moved to Trash.'); } catch (e) { toast(e.message); }
}
async function saCancelSchoolDelete(id) {
  try { await apiPost('/schools/update', { school_id: id, action: 'cancel_delete' }); await loadSuperAdminData(); render(); toast('School restored.'); } catch (e) { toast(e.message); }
}
async function saMarkSchoolPaid(id) {
  if (!confirm('Mark school as PAID for 32 days?')) return;
  try { await apiPost('/schools/update', { school_id: id, action: 'mark_paid' }); await loadSuperAdminData(); render(); toast('School marked Paid.'); } catch (e) { toast(e.message); }
}
async function saMarkSchoolUnpaid(id) {
  if (!confirm('Mark school as UNPAID?')) return;
  try { await apiPost('/schools/update', { school_id: id, action: 'mark_unpaid' }); await loadSuperAdminData(); render(); toast('School marked Unpaid.'); } catch (e) { toast(e.message); }
}
function saContactSchool(id) {
  const s = superSchools.find(x => x.id === id);
  if (!s || !s.admin_email) return toast("No admin email found.");
  const subject = `FeesLedger Message - ${s.name}`;
  const body = `Dear ${s.admin_name || "School Administrator"},\n\nI am contacting you regarding your FeesLedger school account.\n\nSchool: ${s.name}\n\nMessage:\n\n\nRegards,\nFeesLedger Super Admin`;
  window.location.href = `mailto:${encodeURIComponent(s.admin_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  toast("School email draft opened.");
}

async function saApproveRegistration(userId) {
  if (!confirm("Approve this registration? The school admin will be able to log in.")) return;
  try {
    await apiPost('/schools/approve', { user_id: userId, action: 'approve' });
    await loadSuperAdminData(); render();
    toast("Registration approved.");
  } catch (e) { toast(e.message); }
}
async function saRejectRegistration(userId) {
  if (!confirm("Reject this registration? The school admin will not be able to log in.")) return;
  try {
    await apiPost('/schools/approve', { user_id: userId, action: 'reject' });
    await loadSuperAdminData(); render();
    toast("Registration rejected.");
  } catch (e) { toast(e.message); }
}
async function saRestoreRejected(trashId) {
  if (!confirm("Restore this registration? It will return to the pending approvals list and the admin can be approved.")) return;
  try {
    await apiPost('/trash/restore', { id: trashId });
    await loadSuperAdminData(); render();
    toast("Registration restored.");
  } catch (e) { toast(e.message); }
}
async function saPermanentlyDeleteRejected(trashId) {
  if (!confirm("Permanently delete this registration? This cannot be undone.")) return;
  try {
    await apiPost('/trash/delete', { id: trashId });
    await loadSuperAdminData(); render();
    toast("Registration permanently deleted.");
  } catch (e) { toast(e.message); }
}

// ---- METRICS ----
function metrics() {
  let ss = activeStudents(), fees = ss.reduce((a, s) => a + totalFeesFor(s), 0), col = ss.reduce((a, s) => a + paidFor(s), 0);
  return { ss, fees, col, bal: Math.max(0, fees - col), paid: ss.filter(s => statusOf(s) === "paid").length, part: ss.filter(s => statusOf(s) === "partial").length, unpaid: ss.filter(s => statusOf(s) === "unpaid").length };
}

// ---- DASHBOARD ----
function dashboard() {
  let m = metrics(), collection = m.fees ? m.col / m.fees * 100 : 0;
  return `<div class="grid">
 ${metric("Total Classes", db.classes.length)}
 ${metric("Total Students", m.ss.length)}
 ${metric("Paid Students", m.paid)}
 ${metric("Partially Paid", m.part)}
 ${metric("Unpaid Students", m.unpaid)}
 ${metric("Expected Revenue", money(m.fees))}
 ${metric("Collected Revenue", money(m.col))}
 ${metric("Remaining Revenue", money(m.bal))}
 </div>
 <div class="section grid overview-grid">
 <div class="card"><h2>School Overview</h2>${donut(m.paid, m.part, m.unpaid, m.ss.length)}<div class="muted">Overall Collection</div><div class="metric">${pct(collection)}%</div><div class="progress"><i style="width:${collection}%"></i></div></div>
 <div class="card"><h2>Class Performance</h2>${classBars()}</div></div>
 <div class="section card"><h2>Quick Actions</h2><div class="controls">${can("students") ? `<button class="btn primary" onclick="openStudent()">+ Add Student</button>` : ""}${can("classes") ? `<button class="btn success" onclick="openClass()">+ Add Class</button>` : ""}<button class="btn" onclick="page='reports';render()">Reports</button><button class="btn" onclick="window.print()">Print</button></div></div>`;
}
function metric(a, b) { return `<div class="card"><div class="muted">${a}</div><div class="metric">${b}</div></div>`; }
function donut(a, b, c, total) { let p = total ? a / total * 100 : 0, o = total ? b / total * 100 : 0; return `<div class="donut-wrap"><div style="width:120px;height:120px;border-radius:50%;flex-shrink:0;background:conic-gradient(#16a34a 0 ${p}%,#f59e0b ${p}% ${p + o}%,#dc2626 ${p + o}% 100%);position:relative"><div style="position:absolute;inset:25px;background:white;border-radius:50%;display:grid;place-items:center;font-weight:800">${total}</div></div><div><div><span class="badge paid">Paid ${a}</span></div><div style="margin-top:6px"><span class="badge partial">Partial ${b}</span></div><div style="margin-top:6px"><span class="badge unpaid">Unpaid ${c}</span></div></div></div>`; }
function classBars() { let max = Math.max(1, ...db.classes.map(c => classStudents(c).length)); return `<div class="chart">${db.classes.map(c => { let n = classStudents(c).length, h = n / max * 160; let ss = classStudents(c), f = ss.reduce((a, s) => a + totalFeesFor(s), 0), p = ss.reduce((a, s) => a + paidFor(s), 0), pc = f ? p / f * 100 : 0; return `<div class="bar" style="height:${Math.max(5, h)}px" onclick="showClassAnalytics('${c.id}')"><span>${pct(pc)}%</span><small>${esc(c.name)}</small></div>`; }).join("")}</div><button class="btn" onclick="showClassAnalytics('${db.classes[0]?.id || ""}')">Tap To View More</button>`; }

// ---- CLASSES PAGE ----
function classesPage() {
  const classes = db.classes || [];
  const shown = showCount.classes || LOAD_STEP;
  return `<div class="section"><div class="controls no-print">${can("classes") ? `<button class="btn primary" onclick="openClass()">+ Add Another Table</button>` : ""}<button class="btn" onclick="exportCSV()">Export Excel/CSV</button><button class="btn" onclick="printAllClasses()">Print All Classes</button></div></div>
 ${classes.slice(0, shown).map(c => classTable(c)).join("")}${loadMoreBtn("classes", classes.length)}`;
}
function classTable(c) {
  let ss = classStudents(c), f = ss.reduce((a, s) => a + totalFeesFor(s), 0), p = ss.reduce((a, s) => a + paidFor(s), 0), bal = Math.max(0, f - p), pc = f ? p / f * 100 : 0, today = new Date().toDateString();
  return `<div class="card classcard"><div class="classhead"><div><h2>${esc(c.name)}</h2><div class="muted">Unit Price of School Fees: <b>${money(c.unitFee || c.unit_fee)}</b></div></div><div class="controls no-print">${can("classes") ? `<button class="btn" onclick="openClass('${c.id}')">Edit</button><button class="btn danger" onclick="deleteClass('${c.id}')">Delete</button>` : ""}<button class="btn" onclick="exportClass('${c.id}')">Excel</button><button class="btn" onclick="printClass('${c.id}')">PDF/Print</button></div></div>
 <div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>#</th><th>Student</th><th>ID</th><th>Total Fees</th><th>Paid</th><th>Balance</th><th>%</th><th>Status</th><th class="no-print">Actions</th></tr></thead><tbody>
 ${ss.sort((a, b) => a.name.localeCompare(b.name)).map((s, i) => studentRow(s, i + 1)).join("") || `<tr><td colspan="9">No students in this class.</td></tr>`}
 </tbody></table></div>
 <div class="summary">
 ${mini("Total Students", ss.length)}${mini("Paid", ss.filter(s => statusOf(s) === "paid").length)}${mini("Partial", ss.filter(s => statusOf(s) === "partial").length)}${mini("Unpaid", ss.filter(s => statusOf(s) === "unpaid").length)}${mini("Expected", money(f))}${mini("Collected", money(p))}${mini("Remaining", money(bal))}
 </div><div style="margin-top:10px"><div class="muted">Collection ${pct(pc)}%</div><div class="progress"><i style="width:${pc}%"></i></div></div></div>`;
}
function mini(a, b) { return `<div class="mini"><span class="muted">${a}</span><b>${b}</b></div>`; }
function studentRow(s, i) {
  let st = statusOf(s), f = totalFeesFor(s), p = paidFor(s), b = balanceOf(s), pc = percentageOf(s);
  return `<tr><td>${i}</td><td><img class="studentpic" src="${s.photo || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='100%25' height='100%25' fill='%23e2e8f0'/%3E%3Ctext x='50%25' y='55%25' text-anchor='middle' font-size='28'%3E%F0%9F%91%A4%3C/text%3E%3C/svg%3E"}">${esc(s.name)}</td><td>${esc(s.studentId || s.student_id)}</td><td>${money(f)}</td><td>${money(p)}</td><td>${money(b)}</td><td>${pct(pc)}%<div class="progress" style="width:80px"><i style="width:${pc}%"></i></div></td><td><span class="badge ${st}">${st === "paid" ? "✓ PAID" : st === "partial" ? "PARTIALLY PAID" : "UNPAID"}</span></td><td class="actions no-print">${can("payments") ? `<button class="btn success" onclick="setPaid('${s.id}')">PAID</button><button class="btn warning" onclick="openPartial('${s.id}')">PARTIAL</button><button class="btn danger" onclick="setUnpaid('${s.id}')">UNPAID</button>` : ""}<button class="btn primary" onclick="openReceipt('${s.id}')">RECEIPT</button>${can("students") ? `<button class="btn" onclick="openStudent('${s.id}')">Edit</button><button class="btn danger" onclick="deleteStudent('${s.id}')">Delete</button>` : ""}<button class="btn" onclick="studentHistory('${s.id}')">History</button><button class="btn" onclick="printStudentReport('${s.id}')">Print Report</button></td></tr>`;
}

// ---- STUDENTS PAGE ----
function studentsPage() {
  let arr = activeStudents();
  if (classFilter !== "all") arr = arr.filter(s => String(s.classId || s.class_id) === String(classFilter));
  arr = arr.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || (s.studentId || s.student_id || "").toLowerCase().includes(search.toLowerCase()) || (s.parentName || s.parent_name || "").toLowerCase().includes(search.toLowerCase()));
  if (statusFilter !== "all") arr = arr.filter(s => statusOf(s) === statusFilter);
  arr.sort((a, b) => a.name.localeCompare(b.name));
  const shown = showCount.students || LOAD_STEP;
  let classOpts = `<option value="all">All Classes</option>` + db.classes.map(c => `<option value="${c.id}" ${String(classFilter) === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  return `<div class="card"><div class="controls" style="flex-wrap:wrap;gap:10px"><input placeholder="Search student / ID / parent" value="${esc(search)}" oninput="search=this.value;render()"><select onchange="classFilter=this.value;render()">${classOpts}</select><select onchange="statusFilter=this.value;render()"><option value="all">All Statuses</option><option value="paid">Paid</option><option value="partial">Partially Paid</option><option value="unpaid">Unpaid</option></select>${can("students") ? `<button class="btn primary" onclick="openStudent()">+ Add Student</button><button class="btn success" onclick="openPasteStudents()">+ Paste Student Names</button>` : ""}</div></div><div class="section tablewrap"><table><thead><tr><th>#</th><th>Student</th><th>Gender</th><th>Class</th><th>Parent</th><th>Email</th><th>Fees</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>${arr.map((s, i) => (i < shown ? studentRow(s, i + 1) : "")).join("") || `<tr><td colspan="11" class="muted">No students in this class / filter.</td></tr>`}</tbody></table>${loadMoreBtn("students", arr.length)}</div>`;
}

// ---- PAYMENTS PAGE ----
function paymentsPage() {
  const pay = (db.payments || []);
  const shown = showCount.payments || LOAD_STEP;
  return `<div class="card"><h2>Payment History</h2><p class="muted">Every valid payment is permanently recorded.</p></div><div class="section tablewrap"><table><thead><tr><th>Date</th><th>Student</th><th>ID</th><th>Class</th><th>Term</th><th>Amount</th><th>Method</th><th>Recorded By</th></tr></thead><tbody>${pay.map((p, i) => (i < shown ? `<tr><td>${humanDate(p.date || p.payment_date)}</td><td>${esc(p.studentName || p.student_name)}</td><td>${esc(p.studentIdText || p.student_id_text || "")}</td><td>${esc(p.className || p.class_name)}</td><td>${esc(p.term || p.term_name || "")}</td><td>${money(p.amount)}</td><td>${esc(p.method || p.payment_method || "Cash")}</td><td>${esc(p.user || p.recorded_by_email || "")}</td></tr>` : "")).join("") || "<tr><td colspan='8'>No payments.</td></tr>"}</tbody></table>${loadMoreBtn("payments", pay.length)}</div>`;
}

// ---- PARENTS PAGE ----
function parentsPage() {
  const parents = db.parents || [];
  const pmap = {};
  parents.forEach(p => pmap[p.id] = p);
  const q = (window.parentSearch || "").toLowerCase();
  const rows = parents.filter(p => (`${p.name} ${p.email} ${p.phone}`).toLowerCase().includes(q));
  return `<div class="card"><div class="controls" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
    <div><h2 style="margin:0">Parents</h2><p class="muted">Register and manage parent / guardian accounts.</p></div>
    <div class="controls"><input placeholder="Search parent / email…" value="${esc(window.parentSearch || "")}" oninput="window.parentSearch=this.value;render()">${can("parents") || can("students") ? `<button class="btn primary" onclick="openParent()">+ Add Parent</button>` : ""}</div>
  </div></div>
  <div class="section tablewrap"><table><thead><tr><th>#</th><th>Parent</th><th>Email</th><th>Phone</th><th>Children</th><th class="no-print">Actions</th></tr></thead><tbody>
  ${rows.map((p, i) => (i < (showCount.parents || LOAD_STEP) ? `<tr><td>${i + 1}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.email || "—")}</td><td>${esc(p.phone || "—")}</td><td>${esc(p.children_names || "—")} <span class="muted">(${Number(p.child_count) || 0})</span></td>
  <td class="actions no-print">${(can("parents") || can("students")) ? `<button class="btn" onclick="openParent('${p.id}')">Edit</button><button class="btn danger" onclick="deleteParent('${p.id}')">Delete</button>` : ""}</td></tr>` : "")).join("") || `<tr><td colspan="6" class="muted">No parents found.</td></tr>`}
  </tbody></table>${loadMoreBtn("parents", rows.length)}</div>`;
}

function openParent(id) {
  if (!can("parents") && !can("students")) return toast("You do not have permission to manage parents.");
  let p = (db.parents || []).find(x => x.id == id);
  modal(`<h2>${p ? "Edit" : "Add"} Parent</h2><div class="row">
 <div class="formgroup"><label>Parent Name</label><input id="parentName" value="${esc(p?.name || "")}"></div>
 <div class="formgroup"><label>Email (optional)</label><input id="parentEmail" type="email" value="${esc(p?.email || "")}"></div>
 <div class="formgroup"><label>Phone</label><input id="parentPhone" value="${esc(p?.phone || "")}"></div>
 </div><div class="controls"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveParentApi('${id || ""}')">Save Parent</button></div>`);
}

async function saveParentApi(id) {
  let name = document.getElementById("parentName").value.trim(), email = document.getElementById("parentEmail").value.trim(), phone = document.getElementById("parentPhone").value.trim();
  if (!name) return toast("Parent name is required.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("Please enter a valid email.");
  try {
    let body = { name, email, phone };
    if (id) body.id = id;
    await apiPost('/parents/create', body);
    await loadAllData(); closeModal(); render(); toast("Parent saved");
  } catch (e) { toast(e.message); }
}

async function deleteParent(id) {
  if (!can("parents") && !can("students")) return toast("You do not have permission to manage parents.");
  let p = (db.parents || []).find(x => x.id == id);
  if (!p) return;
  if (!confirm(`Delete parent "${p.name}"? It will go to Trash for ${db.trashTTL || 5} days before permanent deletion.`)) return;
  try {
    await apiPost('/parents/delete', { id });
    await loadAllData(); render(); toast("Parent moved to Trash");
  } catch (e) { toast(e.message); }
}

// ---- MESSAGES PAGE ----
function messagesPage() {
  return `<div class="card"><div class="controls"><button class="btn primary" onclick="openMessage()">Compose Email</button><button class="btn" onclick="toast('Templates can be added from Settings.')">Templates</button></div></div>
 <div class="section tablewrap"><table><thead><tr><th>Date</th><th>Type</th><th>Subject</th><th>Recipients</th><th>Status</th></tr></thead><tbody>${(db.messages || []).map(m => `<tr><td>${humanDate(m.date || m.created_at)}</td><td>${m.type}</td><td>${esc(m.subject)}</td><td>${m.count || m.recipient_count}</td><td><span class="badge ${m.status === "sent" ? "paid" : "unpaid"}">${m.status}</span></td></tr>`).join("") || "<tr><td colspan='5'>No messages yet.</td></tr>"}</tbody></table></div>`;
}

// ---- HISTORY PAGE ----
function historyPage() {
  return `<div class="card"><div class="controls"><input placeholder="Search..." value="${esc(historySearch)}" oninput="historySearch=this.value;render()"><button class="btn" onclick="historySearch='';render()">Clear</button></div></div>
 <div class="section"><p class="muted">Activity history loaded from server.</p></div>`;
}

// ---- REPORTS PAGE ----
function reportsPage() {
  return `<div class="grid">${metric("Students", metrics().ss.length)}${metric("Expected", money(metrics().fees))}${metric("Collected", money(metrics().col))}${metric("Collection", pct(metrics().fees ? metrics().col / metrics().fees * 100 : 0) + "%")}</div><div class="section card"><h2>Report Actions</h2><div class="controls"><button class="btn primary" onclick="exportCSV()">Export Excel/CSV</button><button class="btn" onclick="printAllClasses()">Print All Classes</button></div></div><div class="section">${db.classes.map(c => { let ss = classStudents(c), f = ss.reduce((a, s) => a + totalFeesFor(s), 0), p = ss.reduce((a, s) => a + paidFor(s), 0); return `<div class="card" style="margin-bottom:10px"><b>${esc(c.name)}</b> · ${ss.length} students · ${money(p)} / ${money(f)} · ${pct(f ? p / f * 100 : 0)}%</div>`; }).join("")}</div>`;
}

// ---- SETTINGS PAGE ----
function settingsPage() {
  return `<div class="grid"><div class="card"><h2>School Profile</h2><div class="formgroup"><label>School Name</label><input id="schoolName" value="${esc(db?.school?.name || "")}"></div><div class="formgroup"><label>School Email</label><input id="schoolEmail" value="${esc(db?.school?.email || "")}"></div><div class="formgroup"><label>Phone</label><input id="schoolPhone" value="${esc(db?.school?.phone || "")}"></div><button class="btn primary" onclick="saveSchool()">Save School Settings</button></div>
 <div class="card"><h2>Academic Year & Terms</h2><p class="muted">Current: <b>${esc(year)}</b></p></div>
 <div class="card"><h2>Accountants</h2><p class="muted">Manage user accounts from the Users page.</p></div>
 <div class="card"><h2>Change Password</h2><div class="formgroup"><label>Current Password</label><input id="curPwd" type="password"></div><div class="formgroup"><label>New Password</label><input id="newPwd" type="password" placeholder="At least 8 characters"></div><div class="formgroup"><label>Confirm New Password</label><input id="confirmPwd" type="password"></div><button class="btn primary" onclick="changePassword()">Update Password</button></div></div>`;
}

async function changePassword() {
  const current_password = document.getElementById("curPwd").value;
  const new_password = document.getElementById("newPwd").value;
  const confirm_password = document.getElementById("confirmPwd").value;
  if (!current_password || !new_password || !confirm_password) return toast("Please fill in all password fields.");
  if (new_password.length < 8) return toast("New password must be at least 8 characters.");
  if (new_password !== confirm_password) return toast("New passwords do not match.");
  try {
    await apiPost('/auth/change-password', { current_password, new_password, confirm_password });
    toast("Password updated successfully.");
    document.getElementById("curPwd").value = "";
    document.getElementById("newPwd").value = "";
    document.getElementById("confirmPwd").value = "";
  } catch (e) {
    toast(e.message);
  }
}

// ---- USERS PAGE ----
function usersPage() {
  const users = db.users || [];
 const rows = users.map(u => `${u.email} ${u.full_name || ""} ${u.role}`).join(" ").toLowerCase(), q = (window.userSearch || "").toLowerCase();
 const filtered = users.filter(u => (`${u.email} ${u.full_name || ""} ${u.role}`).toLowerCase().includes(q));
 const canManage = can("users") || session?.role === roles.SCHOOL_ADMIN || session?.role === roles.SUPER_ADMIN;
 const shown = showCount.users || LOAD_STEP;
 return `<div class="card"><div class="controls" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><div><h2 style="margin:0">Accountants</h2><p class="muted">Create and manage accountant accounts for your school.</p></div><div class="controls"><input placeholder="Search user…" value="${esc(window.userSearch || "")}" oninput="window.userSearch=this.value;render()">${canManage ? `<button class="btn primary" onclick="openAccountant()">+ Create Accountant</button>` : ""}</div></div></div>
 <div class="section tablewrap"><table><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th class="no-print">Actions</th></tr></thead><tbody>
 ${filtered.map((u, i) => (i < shown ? `<tr><td>${i + 1}</td><td>${esc(u.full_name || "—")}</td><td>${esc(u.email)}</td><td>${esc(u.role || "—")}</td><td><span class="badge ${u.status === "active" ? "paid" : "unpaid"}">${esc(u.status || "—")}</span></td><td class="muted">${esc((u.created_at || "").slice(0, 10))}</td><td class="actions no-print">${canManage && u.role === "accountant" ? `<button class="btn danger" onclick="deleteAccountant('${u.id}')">Delete</button>` : ""}</td></tr>` : "")).join("") || `<tr><td colspan="7" class="muted">No users found.</td></tr>`}
 </tbody></table>${loadMoreBtn("users", filtered.length)}</div>`;
}

async function deleteAccountant(id) {
  if (!confirm("Delete this accountant account? It will go to Trash for " + (db.trashTTL || 5) + " days before permanent deletion.")) return;
  try {
    await apiDelete('/settings/users', { id });
    await loadAllData(); render(); toast("Accountant moved to Trash");
  } catch (e) { toast(e.message); }
}

// ---- SAVE FILES PAGE ----
function savedFilesPage() {
  const files = db.savedFiles || [];
  const q = (saveFilesSearch || "").toLowerCase();
  const rows = files.filter(f => (`${f.display_name} ${f.original_name} ${f.category}`).toLowerCase().includes(q));
  const shown = showCount.files || LOAD_STEP;
  return `<div class="card"><div class="controls" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
    <div><h2 style="margin:0">Save Files</h2><p class="muted">Personal document storage. ${files.length}/${MAX_FILES_PER_USER} files.</p></div>
    <div class="controls"><input placeholder="Search files…" value="${esc(saveFilesSearch)}" oninput="saveFilesSearch=this.value;render()"><label class="btn primary" style="cursor:pointer" for="saveFilesInput">+ Add Files</label><input id="saveFilesInput" type="file" multiple hidden onchange="onSaveFilesSelected(this.files)"></div>
  </div></div>
  <div class="section tablewrap"><table><thead><tr><th>#</th><th>File</th><th>Type</th><th>Size</th><th>Year/Term</th><th>Added</th><th class="no-print">Actions</th></tr></thead><tbody>
  ${rows.map((f, i) => (i < shown ? `<tr><td>${i + 1}</td><td><b>${esc(f.display_name || f.original_name || "Untitled")}</b><br><span class="muted">${esc(f.original_name || "")}</span></td><td><span class="badge ${f.category === "image" ? "paid" : f.category === "pdf" ? "partial" : ""}">${esc(fileCategoryLabel(f.category))}</span></td><td>${sizeText(f.file_size)}</td><td class="muted">${esc(f.academic_year || "—")} · ${esc(f.term || "—")}</td><td class="muted">${humanDate(f.created_at)}</td><td class="actions no-print">
    <a class="btn" href="/api/files/download?id=${f.id}" target="_blank" rel="noopener">Download</a>
    <button class="btn" onclick="renameFile('${f.id}')">Rename</button>
    <button class="btn danger" onclick="deleteFile('${f.id}')">Delete</button></td></tr>` : "")).join("") || `<tr><td colspan="7" class="muted">No files yet. Use "+ Add Files" to upload.</td></tr>`}
  </tbody></table>${loadMoreBtn("files", rows.length)}</div>`;
}

async function onSaveFilesSelected(fileList) {
  let files = Array.from(fileList || []);
  if (!files.length) return;
  for (let f of files) {
    let cat = fileCategory(f);
    if (f.size > (FILE_SIZE_LIMITS[cat] || 10 * 1024 * 1024)) { toast(`"${f.name}" exceeds size limit`); continue; }
    let fd = new FormData();
    fd.append("file", f);
    fd.append("display_name", f.name.replace(/\.[^.]+$/, ""));
    fd.append("year", year);
    fd.append("term", term);
    try { await apiUpload('/files/upload', fd); } catch (e) { toast(e.message); }
  }
  await loadAllData(); render();
  toast("File(s) uploaded");
}

function renameFile(id) {
  let f = (db.savedFiles || []).find(x => x.id == id);
  let name = prompt("New file name:", f?.display_name || f?.original_name || "");
  if (name === null) return;
  if (!name.trim()) return toast("Name cannot be empty.");
  apiPost('/files/rename', { id, display_name: name.trim() }).then(async () => { await loadAllData(); render(); toast("File renamed"); }).catch(e => toast(e.message));
}

async function deleteFile(id) {
  if (!confirm("Delete this file? It will go to Trash for " + (db.trashTTL || 5) + " days before permanent deletion.")) return;
  try {
    await apiPost('/files/delete', { id });
    await loadAllData(); render(); toast("File moved to Trash");
  } catch (e) { toast(e.message); }
}

// ---- TRASH PAGE ----
function trashTypeLabel(t) {
  return ({ student: "Student", parent: "Parent", class: "Class", file: "File", user: "User", school: "School" })[t] || t;
}
function trashPage() {
  const items = (db.trash || []).sort((a, b) => new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0));
  const ttl = db.trashTTL || 5;
  const shown = showCount.trash || LOAD_STEP;
  return `<div class="card"><div class="controls" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
    <div><h2 style="margin:0">Trash</h2><p class="muted">Deleted items are kept for <b>${ttl} days</b>, then permanently removed. You can restore them or clean them at any time.</p></div>
    <div class="controls">${items.length ? `<button class="btn danger" onclick="emptyTrashAll()">Empty Trash (${items.length})</button>` : ""}</div>
  </div></div>
  <div class="section tablewrap"><table><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Days Remaining</th><th>Deleted</th><th class="no-print">Actions</th></tr></thead><tbody>
  ${items.map((t, i) => (i < shown ? `<tr>
    <td>${i + 1}</td>
    <td><b>${esc(t.name || "Untitled")}</b> <span class="muted">(#${esc(t.entity_id)})</span></td>
    <td><span class="badge">${trashTypeLabel(t.entity_type)}</span></td>
    <td>${Number(t.days_left) > 0 ? `<span class="badge ${Number(t.days_left) <= 1 ? "unpaid" : "partial"}">${t.days_left} day${t.days_left == 1 ? "" : "s"} left</span>` : `<span class="badge unpaid">Expired</span>`}</td>
    <td class="muted">${humanDate(t.deleted_at)}</td>
    <td class="actions no-print">
      <button class="btn success" onclick="restoreTrashItem('${t.id}')">Restore</button>
      <button class="btn danger" onclick="deleteTrashItem('${t.id}')">Delete Forever</button>
    </td></tr>` : "")).join("") || `<tr><td colspan="6" class="muted">Trash is empty.</td></tr>`}
  </tbody></table>${loadMoreBtn("trash", items.length)}</div>`;
}
async function restoreTrashItem(id) {
  if (!confirm("Restore this item back to active?")) return;
  try {
    await apiPost('/trash/restore', { id });
    await loadAllData(); render(); toast("Item restored");
  } catch (e) { toast(e.message); }
}
async function deleteTrashItem(id) {
  if (!confirm("Permanently delete this item? This cannot be undone.")) return;
  try {
    await apiPost('/trash/delete', { id });
    await loadAllData(); render(); toast("Item permanently deleted");
  } catch (e) { toast(e.message); }
}
async function emptyTrashAll() {
  const n = (db.trash || []).length;
  if (!n) return;
  if (!confirm(`Empty the entire Trash? ${n} item(s) will be permanently deleted. This cannot be undone.`)) return;
  try {
    await apiPost('/trash/clean', {});
    await loadAllData(); render(); toast("Trash emptied");
  } catch (e) { toast(e.message); }
}

// ---- MODALS ----
function openClass(id) {
  if (!can("classes")) return toast("Only School Admin can manage classes.");
  let c = db.classes.find(x => x.id === id || x.id == id);
  modal(`<h2>${c ? "Edit" : "Add"} Class Table</h2><div class="formgroup"><label>Table Name</label><input id="cname" value="${esc(c?.name || "S1")}"></div><div class="formgroup"><label>Unit Price of School Fees (FRW)</label><input id="cfee" type="number" min="0" value="${c?.unitFee || c?.unit_fee || 0}"></div><div class="controls"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveClassApi('${id || ""}')">Save</button></div>`);
}
async function saveClassApi(id) {
  let name = document.getElementById("cname").value.trim(), fee = Number(document.getElementById("cfee").value);
  if (!name || fee < 0) return toast("Enter valid class and fee.");
  try {
    let body = { name, unit_fee: fee, year: year };
    if (id) body.id = id;
    let res = await apiPost('/classes/create', body);
    await loadAllData();
    closeModal(); render(); toast("Class saved");
  } catch (e) { toast(e.message); }
}
async function deleteClass(id) {
  if (!can("classes")) return toast("Only School Admin can delete classes.");
  let c = db.classes.find(x => x.id == id);
  let enrolled = classStudents(c).length;
  if (enrolled > 0) return toast("Cannot delete: this class has enrolled students. Remove them first.");
  if (!c) return;
  if (!confirm(`Delete class "${c.name}"? It will go to Trash for ${db.trashTTL || 5} days before permanent deletion.`)) return;
  try {
    await apiPost('/classes/delete', { id });
    await loadAllData(); render(); toast("Class moved to Trash");
  } catch (e) { toast(e.message); }
}

async function openStudent(id) {
  if (!can("students")) return toast("You do not have permission to register students.");
  let s = db.students.find(x => x.id == id);
  let classOpts = db.classes.map(c => `<option value="${c.id}" ${s && (s.classId == c.id || s.class_id == c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  let generatedId = "";
  if (!s) {
    let seq = (db.students || []).filter(x => x.year === year || !x.year).length + 1;
    generatedId = "STU-" + (year.split("–")[0] || year) + "-" + String(seq).padStart(4, "0");
  }
  modal(`<h2>${s ? "Edit" : "Register"} Student</h2><div class="row">
 <div class="formgroup"><label>Student Name</label><input id="sname" value="${esc(s?.name || "")}"></div>
 <div class="formgroup"><label>Student ID</label><input id="sid" value="${esc(s ? (s.studentId || s.student_id) : "")}" ${s ? "" : `placeholder="${esc(generatedId)}"`}><div class="muted">${s ? "Edit if needed" : "Auto-generated. Leave blank to auto-generate."}</div></div>
 <div class="formgroup"><label>Gender</label><select id="gender"><option ${s?.gender === "M" ? "selected" : ""}>M</option><option ${s?.gender === "F" ? "selected" : ""}>F</option></select></div>
 <div class="formgroup"><label>Class</label><select id="sclass">${classOpts}</select></div>
 <div class="formgroup"><label>Parent Name</label><input id="pname" value="${esc(s?.parentName || s?.parent_name || "")}"></div>
 <div class="formgroup"><label>Parent Email (optional)</label><input id="pemail" type="email" value="${esc(s?.parentEmail || s?.parent_email || "")}"></div>
 <div class="formgroup"><label>Parent Phone</label><input id="pphone" value="${esc(s?.parentPhone || s?.parent_phone || "")}"></div>
 <div class="formgroup"><label>Photo</label>${s?.photo ? `<img src="${s.photo}" style="width:48px;height:48px;object-fit:cover;border-radius:50%;display:block;margin-bottom:6px">` : ""}<input id="sphoto" type="file" accept="image/*" onchange="uploadStudentPhoto('${id || ""}')"></div>
 </div><div class="controls"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveStudentApi('${id || ""}')">Save Student</button></div>`);
}

async function uploadStudentPhoto(id) {
  let input = document.getElementById("sphoto");
  let file = input.files[0];
  if (!file) return;
  if (!id) { toast("Save the student first, then upload a photo."); return; }
  if (!/^image\//.test(file.type)) return toast("Please choose an image file.");
  if (file.size > 5 * 1024 * 1024) return toast("Image must be under 5MB.");
  let fd = new FormData();
  fd.append("photo", file);
  fd.append("student_id", id);
  try {
    await apiUpload('/students/photo', fd);
    await loadAllData();
    toast("Photo uploaded");
  } catch (e) { toast(e.message); }
}

async function deleteStudent(id) {
  if (!can("students")) return toast("You do not have permission to delete students.");
  let s = db.students.find(x => x.id == id);
  if (!s) return;
  if (!confirm(`Delete student "${s.name}"? It will go to Trash for ${db.trashTTL || 5} days before permanent deletion.`)) return;
  try {
    await apiPost('/students/delete', { id });
    await loadAllData(); render(); toast("Student moved to Trash");
  } catch (e) { toast(e.message); }
}
async function saveStudentApi(id) {
  let name = document.getElementById("sname").value.trim(), sid = document.getElementById("sid").value.trim(), classId = document.getElementById("sclass").value, parentName = document.getElementById("pname").value.trim(), parentEmail = document.getElementById("pemail").value.trim(), parentPhone = document.getElementById("pphone").value.trim(), gender = document.getElementById("gender").value;
  if (!name || !classId) return toast("Student name and class are required.");
  if (!sid) {
    let seq = (db.students || []).filter(x => x.year === year || !x.year).length + 1;
    sid = "STU-" + (year.split("–")[0] || year) + "-" + String(seq).padStart(4, "0");
  }
  if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) return toast("Please enter a valid parent email.");
  try {
    let body = { name, student_id: sid, class_id: classId, parent_name: parentName, parent_email: parentEmail, parent_phone: parentPhone, gender };
    if (id) body.id = id;
    await apiPost('/students/create', body);
    await loadAllData();
    closeModal(); render(); toast("Student saved");
  } catch (e) { toast(e.message); }
}

function openPasteStudents() {
  if (!can("students")) return toast("You do not have permission to register students.");
  modal(`<h2>Paste Student Names</h2><p class="muted">One name per line.</p><div class="formgroup"><label>Class</label><select id="pasteClass">${db.classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div><div class="formgroup"><label>Student Names</label><textarea id="pasteNames" style="min-height:220px" placeholder="John Doe\nAlice Uwase"></textarea></div><div class="controls"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="importPastedStudentsApi()">Import</button></div>`);
}
async function importPastedStudentsApi() {
  let names = document.getElementById("pasteNames").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean), classId = document.getElementById("pasteClass").value;
  if (!names.length) return toast("Paste at least one name.");
  try {
    let res = await apiPost('/students/import', { names, class_id: classId, year });
    await loadAllData();
    closeModal(); render();
    toast(`${res.data.added} imported, ${res.data.duplicates} duplicates`);
  } catch (e) { toast(e.message); }
}

// ---- PAYMENT ACTIONS ----
async function setPaid(id) {
  if (!can("payments")) return toast("Only Accountant can record payments.");
  let s = db.students.find(x => x.id == id), need = balanceOf(s);
  if (need <= 0) return toast("Already fully paid.");
  if (!confirm("Mark as fully paid?")) return;
  try {
    await apiPost('/payments/create', { student_id: id, amount: need, method: "cash", term });
    await loadAllData(); render(); toast("Student marked Fully Paid");
  } catch (e) { toast(e.message); }
}

function openPartial(id) {
  if (!can("payments")) return toast("Only Accountant can record payments.");
  let s = db.students.find(x => x.id == id), remaining = balanceOf(s);
  modal(`<h2>Partially Paid</h2><div class="muted">${esc(s.name)}</div><div class="formgroup"><label>Amount (FRW)</label><input id="payAmount" type="number" min="0" step="1" value="${remaining}"></div><div class="controls"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn warning" onclick="confirmPartialApi('${id}')">Save</button></div>`);
}
async function confirmPartialApi(id) {
  let amount = Number(document.getElementById("payAmount").value);
  if (amount <= 0) return toast("Enter a valid amount.");
  try {
    await apiPost('/payments/create', { student_id: id, amount, method: "cash", term });
    await loadAllData(); closeModal(); render(); toast("Payment recorded.");
  } catch (e) { toast(e.message); }
}

async function setUnpaid(id) {
  if (!can('payments')) return toast('Only Accountant can record payments.');
  if (!confirm('Confirm student is unpaid?')) return;
  try {
    await apiPost('/payments/create', { student_id: id, amount: 0, method: 'cash', term });
    await loadAllData(); render(); toast('Student status updated');
  } catch (e) { toast(e.message); }
}

// ---- RECEIPT ----
function openReceipt(id) {
  let s = db.students.find(x => x.id == id);
  if (!s) return toast("Student not found.");
  let f = totalFeesFor(s), p = paidFor(s), b = balanceOf(s), st = statusOf(s);
  modal(`<div class="receipt-wrap"><div class="receipt-paper"><div class="receipt-head"><div><h1>${esc(db?.school?.name || "School")}</h1><div class="muted">${esc(db?.school?.email || "")} ${db?.school?.phone ? "· " + esc(db.school.phone) : ""}</div></div></div><div class="receipt-title">SCHOOL FEES RECEIPT</div><div class="receipt-meta"><span>Receipt No: <b>${esc("REC-" + Math.floor(Math.random() * 999999).toString().padStart(6, "0"))}</b></span><span>Date: <b>${new Date().toLocaleDateString()}</b></span></div><div class="receipt-grid"><div class="receipt-photo">${s.photo ? `<img src="${s.photo}">` : `<div class="photo-placeholder">Student<br>Photo</div>`}</div><div><h3>Student Information</h3><p><b>Name:</b> ${esc(s.name)}</p><p><b>Student ID:</b> ${esc(s.studentId || s.student_id)}</p><p><b>Class:</b> ${esc(db.classes.find(c => c.id == (s.classId || s.class_id))?.name || "")}</p></div><div><h3>Parent / Guardian</h3><p><b>Name:</b> ${esc(s.parentName || s.parent_name || "Not provided")}</p><p><b>Email:</b> ${esc(s.parentEmail || s.parent_email || "—")}</p><p><b>Phone:</b> ${esc(s.parentPhone || s.parent_phone || "—")}</p></div></div><div class="receipt-payment"><h3>Payment Information</h3><div class="payline"><span>Total Fees</span><b>${money(f)}</b></div><div class="payline"><span>Total Paid</span><b>${money(p)}</b></div><div class="payline balance"><span>Remaining Balance</span><b>${money(b)}</b></div></div><div class="receipt-status ${st}">${st === "paid" ? "✓ PAID" : st === "partial" ? "PARTIALLY PAID" : "UNPAID"}</div><div class="receipt-footer">Thank you for your payment.<br><b>${esc(db?.school?.name || "School")} Administration · FeesLedger</b></div></div><div class="controls no-print" style="margin-top:14px;justify-content:center"><button class="btn" onclick="closeModal()">Close</button></div></div>`);
}

function studentHistory(id) {
  let s = db.students.find(x => x.id == id);
  let ps = (db.payments || []).filter(p => p.studentId == id || p.student_id == id).sort((a, b) => new Date(b.date || b.payment_date) - new Date(a.date || a.payment_date));
  modal(`<h2>Payment History — ${esc(s.name)}</h2>${ps.map(p => `<div class="childcard"><div><b>${money(p.amount)}</b><div class="muted">${humanDate(p.date || p.payment_date)} · ${esc(p.term || p.term_name || "")}</div></div></div>`).join("") || "<p>No payments recorded.</p>"}<div class="controls" style="margin-top:14px"><button class="btn" onclick="closeModal()">Close</button><button class="btn primary" onclick="printStudentReport('${id}')">Print Student Report</button></div>`);
}

function showClassAnalytics(id) {
  let c = db.classes.find(x => x.id == id); if (!c) return;
  let ss = classStudents(c), f = ss.reduce((a, s) => a + totalFeesFor(s), 0), p = ss.reduce((a, s) => a + paidFor(s), 0);
  modal(`<h2>${esc(c.name)} Analytics</h2><div class="grid">${metric("Students", ss.length)}${metric("Paid", ss.filter(s => statusOf(s) === "paid").length)}${metric("Partial", ss.filter(s => statusOf(s) === "partial").length)}${metric("Unpaid", ss.filter(s => statusOf(s) === "unpaid").length)}${metric("Expected", money(f))}${metric("Collected", money(p))}${metric("Remaining", money(Math.max(0, f - p)))}${metric("Collection", pct(f ? p / f * 100 : 0) + "%")}</div><button class="btn" style="margin-top:15px" onclick="closeModal()">Close</button>`);
}

// ---- MESSAGES ----
function openMessage() {
  modal(`<h2>Compose Email</h2><div class="formgroup"><label>Subject</label><input id="msub" value="Parent Meeting Invitation"></div><div class="formgroup"><label>Message</label><textarea id="mbody">Dear Parents,\n\nYou are invited to attend our parents' meeting.\n\nThank you.</textarea></div><div class="controls"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="sendMessageApi()">Send</button></div>`);
}
async function sendMessageApi() {
  let subject = document.getElementById("msub").value.trim(), body = document.getElementById("mbody").value;
  if (!subject) return toast("Subject required");
  try {
    await apiPost('/messages/send', { type: "Manual", subject, body, count: 0, status: "sent" });
    toast("Message recorded");
    closeModal();
  } catch (e) { toast(e.message); }
}

// ---- MFA ----
async function setupMFA() {
  try {
    let res = await apiPost('/auth/mfa/setup', {});
    let data = res.data;
    modal(`<div class="otpbox"><h2>Set up MFA</h2><p>Scan this QR with Google Authenticator or Authy.</p><div id="qr" style="display:flex;justify-content:center"></div><p class="muted">Secret: ${esc(data.secret)}</p><input id="setupOtp" class="otp" maxlength="6" placeholder="000000"><p class="muted">Enter the 6-digit OTP to verify.</p><div class="controls" style="justify-content:center"><button class="btn primary" onclick="verifyMfaSetup()">Verify & Enable</button></div></div>`);
    if (window.QRCode) { setTimeout(() => new QRCode(document.getElementById('qr'), { text: data.uri, width: 210, height: 210 }), 50); }
  } catch (e) { toast(e.message); }
}
async function verifyMfaSetup() {
  let code = document.getElementById('setupOtp').value;
  try {
    let res = await apiPost('/auth/mfa/verify', { code });
    let codes = res.data.backup_codes || [];
    closeModal();
    modal(`<h2>MFA Enabled!</h2><p class="muted">Save these backup codes:</p><div class="card"><code style="display:block;line-height:2">${codes.join('<br>')}</code></div><div class="controls"><button class="btn primary" onclick="closeModal()">Done</button></div>`);
    toast('MFA enabled!');
  } catch (e) { toast(e.message); }
}
async function generateBackupCodes() {
  try {
    let res = await apiPost('/auth/mfa/setup', {});
    toast('New MFA setup ready. Complete verification to get backup codes.');
  } catch (e) { toast(e.message); }
}

// ---- ACCOUNTANT ----
function openAccountant() {
  modal(`<h2>Create Accountant</h2><div class="formgroup"><label>Email</label><input id="ae" type="email"></div><div class="formgroup"><label>Password</label><input id="ap" value="ChangeMe123!"></div><div class="controls"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveAccountantApi()">Create</button></div>`);
}
async function saveAccountantApi() {
  let email = document.getElementById("ae").value.trim(), password = document.getElementById("ap").value;
  if (!email) return toast("Email required");
  try {
    await apiPost('/settings/users', { email, password });
    await loadAllData(); closeModal(); toast("Accountant created"); render();
  } catch (e) { toast(e.message); }
}

// ---- SCHOOLS (Super Admin) ----
async function contactSchool(id) {
  let email = prompt("Enter school admin email:");
  if (!email) return;
  try {
    await apiPost('/messages/send', { type: 'Super Admin → School', subject: 'FeesLedger Message', body: 'Message from Super Admin', count: 1, status: 'sent', recipients: email });
    toast('Message recorded');
  } catch (e) { toast(e.message); }
}
function contactSuperAdmin() { toast('Contact Super Admin via email.'); }
async function requestSchoolDelete(id) {
  if (!confirm('Confirm delete request? School will be recoverable for 10 days.')) return;
  try {
    await apiPost('/schools/update', { school_id: id, action: 'request_delete' });
    toast('Delete scheduled. 10 days to restore.');
  } catch (e) { toast(e.message); }
}
async function cancelSchoolDelete(id) {
  try {
    await apiPost('/schools/update', { school_id: id, action: 'cancel_delete' });
    toast('School restored to Active.');
  } catch (e) { toast(e.message); }
}
async function setSchoolStatus(id, status) {
  if (!confirm('Confirm status change?')) return;
  try {
    await apiPost('/schools/update', { school_id: id, action: 'set_status', status });
    toast('Status updated.');
  } catch (e) { toast(e.message); }
}
async function markSchoolPaid(id) {
  if (!confirm('Mark school as PAID for 32 days?')) return;
  try {
    await apiPost('/schools/update', { school_id: id, action: 'mark_paid' });
    toast('School marked Paid for 32 days.');
  } catch (e) { toast(e.message); }
}
async function markSchoolUnpaid(id) {
  if (!confirm('Mark school as UNPAID?')) return;
  try {
    await apiPost('/schools/update', { school_id: id, action: 'mark_unpaid' });
    toast('School marked Unpaid.');
  } catch (e) { toast(e.message); }
}
function updateSchoolEmailAudience() {}
function openSchoolEmail() { toast('School email draft opened.'); }

// ---- AUTH ----
function renderLogin() {
  document.getElementById("root").innerHTML = `<div class="login"><div class="loginbox">
    <div style="text-align:center;margin-bottom:20px">
      <h1 style="margin:0">Fees<span style="color:#16a34a">Ledger</span></h1>
      <p class="muted">Secure School Fees Management</p>
    </div>
    <div id="loginStep">
      <div class="formgroup">
        <label>Email Address</label>
        <input id="le" placeholder="admin@school.com">
      </div>
      <div class="formgroup">
        <label>Password</label>
        <input id="lp" type="password" placeholder="Enter your password">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px">
        <button class="btn primary" style="width:100%;padding:12px;font-weight:700" onclick="loginApi()">Login</button>
        <button class="btn" style="width:100%;padding:12px;border:1px solid #16a34a;color:#16a34a;background:#fff;font-weight:700" onclick="openRegisterModal()">Register</button>
      </div>
      <p style="text-align:center;margin:16px 0 0;color:#64748b;font-size:13px">New school? <button type="button" onclick="openRegisterModal()" style="border:0;background:none;color:#16a34a;font-weight:700;cursor:pointer;padding:0">Create an account</button></p>
    </div>
  </div></div>`;
}

async function loginApi() {
  let email = document.getElementById("le").value.trim(), password = document.getElementById("lp").value;
  if (!email || !password) return toast("Email and password are required");
  try {
    let res = await apiPost('/auth/login', { email, password });
    let data = res.data;
    if (data.status === 'requires_mfa_enrollment') {
      renderMfaSetup(email, data.mfa_secret, data.uri || data.mfa_uri);
      return;
    }
    if (data.status === 'requires_mfa') {
      renderMfaVerify(email);
      return;
    }
    session = data;
    if (session.role === roles.SUPER_ADMIN) {
      await loadSuperAdminData();
    } else {
      await loadAllData();
    }
    render();
  } catch (e) { toast(e.message); }
}

function renderMfaSetup(email, secret, uri) {
  document.getElementById("root").innerHTML = `<div class="login"><div class="loginbox" style="max-width:480px">
    <div style="text-align:center;margin-bottom:20px">
      <h1 style="margin:0">Fees<span style="color:#16a34a">Ledger</span></h1>
      <p class="muted">Set Up Two-Factor Authentication</p>
    </div>
    <p style="text-align:center;color:#64748b;font-size:14px">Scan this QR code with Google Authenticator or Authy, then enter the 6-digit code. This secures your account.</p>
    <div id="setupQr" style="display:flex;justify-content:center;margin:14px 0"></div>
    <div class="formgroup"><label>Secret Key</label><input id="setupMfaSecret" value="${esc(secret)}" readonly onclick="this.select()"></div>
    <div class="formgroup"><label>6-Digit Code</label><input id="setupMfaOtp" class="otp" maxlength="6" placeholder="000000" inputmode="numeric"></div>
    <div class="controls" style="justify-content:center;margin-top:14px">
      <button class="btn" onclick="renderLogin()">Back to Login</button>
      <button class="btn primary" onclick="verifyMfaEnrollment('${esc(email)}')">Verify & Continue</button>
    </div>
  </div></div>`;
  if (window.QRCode) { setTimeout(() => new QRCode(document.getElementById('setupQr'), { text: uri, width: 200, height: 200 }), 50); }
}

async function verifyMfaEnrollment(email) {
  let code = document.getElementById("setupMfaOtp").value;
  if (!/^\d{6}$/.test(code)) return toast("Enter the 6-digit code from your authenticator app");
  try {
    let res = await apiPost('/auth/mfa/verify', { code });
    let data = res.data;
    let codes = data.backup_codes || [];
    closeModal();
    if (data.status === 'requires_approval') {
      document.getElementById("root").innerHTML = `<div class="login"><div class="loginbox" style="max-width:480px">
        <div style="text-align:center;margin-bottom:20px">
          <h1 style="margin:0">Fees<span style="color:#16a34a">Ledger</span></h1>
          <p class="muted">Two-Factor Enabled</p>
        </div>
        <p style="text-align:center;color:#64748b">Your account is secured with Two-Factor Authentication. Save these backup codes in a safe place — you will need them if you lose your device.</p>
        <div class="card"><code style="display:block;line-height:2;text-align:center">${codes.join('<br>')}</code></div>
        <div class="controls" style="justify-content:center;margin-top:16px"><button class="btn primary" onclick="showAwaitingApproval('${esc(email)}')">Continue</button></div>
      </div></div>`;
    } else {
      session = data;
      if (session.role === roles.SUPER_ADMIN) {
        await loadSuperAdminData();
      } else {
        await loadAllData();
      }
      render();
      toast("Welcome! Two-Factor Authentication is now enabled.");
    }
  } catch (e) { toast(e.message); }
}

function showAwaitingApproval(email) {
  document.getElementById("root").innerHTML = `<div class="login"><div class="loginbox" style="max-width:460px">
    <div style="text-align:center;margin-bottom:20px">
      <h1 style="margin:0">Fees<span style="color:#16a34a">Ledger</span></h1>
      <p class="muted">Registration Submitted</p>
    </div>
    <div style="text-align:center;padding:10px 0">
      <div style="font-size:48px">⏳</div>
      <h2 style="margin:8px 0">Awaiting Approval</h2>
      <p style="color:#64748b;line-height:1.6">Your account (${esc(email)}) has been created and secured with Two-Factor Authentication.<br><br>It is currently <b>pending approval</b> by the FeesLedger Super Administrator. You will be able to log in once your account is approved.</p>
    </div>
    <div class="controls" style="justify-content:center;margin-top:16px"><button class="btn primary" onclick="renderLogin()">Back to Login</button></div>
  </div></div>`;
}

function renderMfaVerify(email) {
  document.getElementById("root").innerHTML = `<div class="login"><div class="loginbox" style="max-width:440px">
    <div style="text-align:center;margin-bottom:20px">
      <h1 style="margin:0">Fees<span style="color:#16a34a">Ledger</span></h1>
      <p class="muted">Two-Factor Authentication</p>
    </div>
    <p style="text-align:center;color:#64748b">Enter the 6-digit code from your authenticator app for ${esc(email)}.</p>
    <div class="formgroup"><label>Authentication Code</label><input id="mfaLoginOtp" class="otp" maxlength="6" placeholder="000000" inputmode="numeric"></div>
    <div class="controls" style="justify-content:center;margin-top:14px">
      <button class="btn" onclick="renderLogin()">Back</button>
      <button class="btn primary" onclick="verifyMfaLogin()">Verify</button>
    </div>
  </div></div>`;
}

async function verifyMfaLogin() {
  let code = document.getElementById("mfaLoginOtp").value;
  if (!/^\d{6}$/.test(code)) return toast("Enter the 6-digit code from your authenticator app");
  try {
    let res = await apiPost('/auth/mfa/verify', { code });
    session = res.data;
    if (session.role === roles.SUPER_ADMIN) {
      await loadSuperAdminData();
    } else {
      await loadAllData();
    }
    closeModal(); render();
  } catch (e) { toast(e.message); }
}

function openRegisterModal() {
  document.getElementById("root").innerHTML = `<div class="login"><div class="loginbox" style="max-width:480px">
    <div style="text-align:center;margin-bottom:20px">
      <h1 style="margin:0">Fees<span style="color:#16a34a">Ledger</span></h1>
      <p class="muted">Create Your School Administrator Account</p>
    </div>
    <div class="formgroup">
      <label>Full Name</label>
      <input id="regName" placeholder="Enter your full name">
    </div>
    <div class="formgroup">
      <label>School Name</label>
      <input id="regSchool" placeholder="Enter your school name">
    </div>
    <div class="formgroup">
      <label>Email Address</label>
      <input id="regEmail" type="email" placeholder="admin@school.com">
    </div>
    <div class="formgroup">
      <label>Password</label>
      <input id="regPassword" type="password" minlength="8" placeholder="Minimum 8 characters">
    </div>
    <div class="formgroup">
      <label>Confirm Password</label>
      <input id="regConfirm" type="password" placeholder="Repeat your password">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px">
      <button class="btn" style="width:100%;padding:12px;border:1px solid #d0d5dd;background:#fff;color:#344054;font-weight:600" onclick="renderLogin()">← Back to Login</button>
      <button class="btn primary" style="width:100%;padding:12px;font-weight:700" onclick="registerApi()">Create Account</button>
    </div>
    <p style="text-align:center;margin:16px 0 0;color:#64748b;font-size:13px">Already have an account? <button type="button" onclick="renderLogin()" style="border:0;background:none;color:#16a34a;font-weight:700;cursor:pointer;padding:0">Sign in</button></p>
  </div></div>`;
}

async function registerApi() {
  let name = document.getElementById("regName").value.trim(), school = document.getElementById("regSchool").value.trim(), email = document.getElementById("regEmail").value.trim(), password = document.getElementById("regPassword").value, confirm = document.getElementById("regConfirm").value;
  if (!name || !school || !email || !password) return toast("All fields are required");
  if (password !== confirm) return toast("Passwords do not match");
  try {
    let res = await apiPost('/auth/register', { full_name: name, school_name: school, email, password, confirm_password: confirm });
    let data = res.data;
    closeModal();
    renderMfaSetup(email, data.mfa_secret, data.mfa_uri);
    toast("Account created! Set up Two-Factor Authentication to continue.");
  } catch (e) { toast(e.message); }
}

async function createFirstSuperAdmin() {
  document.getElementById("root").innerHTML = `<div class="login"><div class="loginbox" style="max-width:480px">
    <div style="text-align:center;margin-bottom:20px">
      <h1 style="margin:0">Fees<span style="color:#16a34a">Ledger</span></h1>
      <p class="muted">Create Super Admin Account</p>
      <p style="color:#64748b;font-size:12px;margin-top:4px">This special setup is available only when no Super Admin exists.</p>
    </div>
    <div class="formgroup">
      <label>Full Name</label>
      <input id="saName" placeholder="Enter your full name">
    </div>
    <div class="formgroup">
      <label>Email Address</label>
      <input id="saEmail" type="email" placeholder="admin@example.com">
    </div>
    <div class="formgroup">
      <label>Password</label>
      <input id="saPassword" type="password" minlength="8" placeholder="Minimum 8 characters">
    </div>
    <div class="formgroup">
      <label>Confirm Password</label>
      <input id="saConfirm" type="password" placeholder="Repeat your password">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px">
      <button class="btn" style="width:100%;padding:12px;border:1px solid #d0d5dd;background:#fff;color:#344054;font-weight:600" onclick="renderLogin()">← Back to Login</button>
      <button class="btn primary" style="width:100%;padding:12px;font-weight:700" onclick="submitSuperAdmin()">Create Admin</button>
    </div>
    <p style="text-align:center;margin:16px 0 0;color:#64748b;font-size:13px">Already have an account? <button type="button" onclick="renderLogin()" style="border:0;background:none;color:#16a34a;font-weight:700;cursor:pointer;padding:0">Sign in</button></p>
  </div></div>`;
}

async function submitSuperAdmin() {
  let name = document.getElementById("saName").value.trim(), email = document.getElementById("saEmail").value.trim(), pw = document.getElementById("saPassword").value, cpw = document.getElementById("saConfirm").value;
  if (pw !== cpw) return toast("Passwords do not match");
  if (pw.length < 8) return toast("Password too short");
  try {
    let res = await apiPost('/auth/register-super-admin', { full_name: name, email, password: pw, confirm_password: cpw });
    let data = res.data;
    closeModal();
    renderMfaSetup(email, data.mfa_secret, data.mfa_uri);
    toast("Super Admin created! Set up Two-Factor Authentication to continue.");
  } catch (e) { toast(e.message); }
}

async function logout() {
  try { await apiPost('/auth/logout', {}); } catch (e) {}
  session = null;
  db = null;
  render();
}

function saveSchool() {
  let name = document.getElementById("schoolName").value.trim(), email = document.getElementById("schoolEmail").value.trim(), phone = document.getElementById("schoolPhone").value.trim();
  apiPatch('/settings/school', { name, email, phone }).then(() => {
    db.school = { ...db.school, name, email, phone };
    toast("School settings saved"); render();
  }).catch(e => toast(e.message));
}

function readImage(input, target) {
  let f = input.files[0]; if (!f) return;
  let r = new FileReader();
  r.onload = () => {
    if (target === "schoolLogo") db.school.logo = r.result;
    else if (document.getElementById("photoData")) document.getElementById("photoData").value = r.result;
  };
  r.readAsDataURL(f);
}

function exportCSV() {
  window.open('/api/reports/export?year=' + encodeURIComponent(year) + '&term=' + encodeURIComponent(term), '_blank');
}
function exportClass(id) {
  let c = db.classes.find(x => String(x.id) === String(id));
  if (!c) return toast("Class not found.");
  let rows = [["Student ID", "Student", "Class", "Fees", "Paid", "Balance", "Percentage", "Status"]];
  classStudents(c).forEach(s => rows.push([s.studentId, s.name, c.name, totalFeesFor(s), paidFor(s), balanceOf(s), pct(percentageOf(s)) + "%", statusOf(s)]));
  let blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" });
  let a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = c.name + "_Report.csv";
  a.click();
}

function printWindow(title, bodyHtml) {
  let w = window.open("", "_blank");
  let styles = (document.querySelector("style")?.innerHTML) || "";
  let printable = `<html><head><title>${esc(title)}</title><style>
    ${styles}
    @media print { aside,.top,.actions,.no-print,.controls button{ display:none !important; } main{ padding:0 !important; } .card,.tablewrap{ box-shadow:none !important; } }
    body { font-family: Arial, sans-serif; margin: 20px; }
    .print-head { text-align:center; margin-bottom:16px; }
    .print-head h1{ margin:0 0 4px; }
    table { width:100%; border-collapse:collapse; margin-bottom:20px; }
    th,td { border:1px solid #ccc; padding:6px 8px; font-size:12px; text-align:left; }
    th { background:#f1f5f9; }
    .print-header { page-break-after: avoid; }
    .print-section { page-break-inside: auto; }
    .print-section .class-title { font-size:16px; font-weight:700; margin:16px 0 6px; }
  </style></head><body>
  <div class="print-head"><h1>${esc(db?.school?.name || "School")}</h1><div>${esc(db?.school?.email || "")} ${db?.school?.phone ? "· " + esc(db.school.phone) : ""}</div><div>${esc(year)} · ${esc(term)}</div></div>
  ${bodyHtml}
  </body></html>`;
  w.document.write(printable);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

function classPrintTable(c) {
  let ss = classStudents(c);
  let rows = ss.sort((a, b) => a.name.localeCompare(b.name)).map(s => {
    let f = totalFeesFor(s), p = paidFor(s), b = balanceOf(s), pc = percentageOf(s);
    return `<tr><td>${esc(s.studentId || s.student_id)}</td><td>${esc(s.name)}</td><td>${money(f)}</td><td>${money(p)}</td><td>${money(b)}</td><td>${pct(pc)}%</td><td>${statusOf(s).toUpperCase()}</td></tr>`;
  }).join("");
  return `<div class="print-section"><div class="class-title">${esc(c.name)} — ${ss.length} student(s)</div>
    <table><thead><tr><th>Student ID</th><th>Student</th><th>Total Fees</th><th>Paid</th><th>Balance</th><th>%</th><th>Status</th></tr></thead><tbody>${rows || `<tr><td colspan="7">No students.</td></tr>`}</tbody></table></div>`;
}

function printAllClasses() {
  let body = db.classes.map(c => classPrintTable(c)).join("");
  if (!body) body = "<p>No classes available.</p>";
  printWindow("All Classes Report", body);
}

function printClass(id) {
  let c = db.classes.find(x => String(x.id) === String(id));
  if (!c) return toast("Class not found.");
  printWindow("Report — " + c.name, classPrintTable(c));
}

function printStudentReport(id) {
  let s = db.students.find(x => String(x.id) === String(id));
  if (!s) return toast("Student not found.");
  let c = db.classes.find(x => String(x.id) === String(s.classId || s.class_id));
  let f = totalFeesFor(s), p = paidFor(s), b = balanceOf(s), pc = percentageOf(s), st = statusOf(s);
  let ps = (db.payments || []).filter(x => String(x.studentId || x.student_id) === String(id)).sort((a, bb) => new Date(bb.date || bb.payment_date) - new Date(a.date || a.payment_date));
  let payRows = ps.map(x => `<tr><td>${humanDate(x.date || x.payment_date)}</td><td>${esc(x.term || x.term_name || "—")}</td><td>${esc(x.method || x.payment_method || "Cash")}</td><td>${money(x.amount)}</td></tr>`).join("") || `<tr><td colspan="4">No payments recorded.</td></tr>`;
  let body = `
    <div class="print-section"><div style="text-align:center"><h2 style="margin:6px 0">STUDENT REPORT</h2></div>
      <table><thead><tr><th>Student ID</th><th>Name</th><th>Gender</th><th>Class</th><th>Parent</th><th>Parent Email</th><th>Parent Phone</th></tr></thead>
      <tbody><tr><td>${esc(s.studentId || s.student_id)}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.gender || "—")}</td><td>${esc(c?.name || "—")}</td><td>${esc(s.parentName || s.parent_name || "—")}</td><td>${esc(s.parentEmail || s.parent_email || "—")}</td><td>${esc(s.parentPhone || s.parent_phone || "—")}</td></tr></tbody></table>
    </div>
    <div class="print-section"><div class="class-title">Fees Summary</div>
      <table><thead><tr><th>Total Fees</th><th>Paid</th><th>Balance</th><th>%</th><th>Status</th></tr></thead>
      <tbody><tr><td>${money(f)}</td><td>${money(p)}</td><td>${money(b)}</td><td>${pct(pc)}%</td><td>${st.toUpperCase()}</td></tr></tbody></table>
    </div>
    <div class="print-section"><div class="class-title">Payment History</div>
      <table><thead><tr><th>Date</th><th>Term</th><th>Method</th><th>Amount</th></tr></thead><tbody>${payRows}</tbody></table>
    </div>`;
  printWindow("Student Report — " + s.name, body);
}
async function openAcademicSettings() {
  try {
    let res = await apiGet('/academic/config?year=' + encodeURIComponent(year));
    let terms = res.data?.terms || [];
    modal(`<h2>Academic Year & Terms</h2><p class="muted">Manage ${esc(year)}</p>${terms.map((t, i) => `<div class="card" style="margin:8px 0"><b>${esc(t.name)}</b><div class="row"><div class="formgroup"><label>Start</label><input id="tstart${i}" type="date" value="${t.start_date || ''}"></div><div class="formgroup"><label>End</label><input id="tend${i}" type="date" value="${t.end_date || ''}"></div></div></div>`).join('')}<div class="controls"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveAcademicSettingsApi()">Save</button></div>`);
  } catch (e) { toast(e.message); }
}
async function saveAcademicSettingsApi() {
  try {
    let terms = [];
    for (let i = 0; i < 3; i++) {
      let nameEl = document.getElementById('tname' + i);
      let startEl = document.getElementById('tstart' + i);
      let endEl = document.getElementById('tend' + i);
      terms.push({ name: nameEl ? nameEl.value : 'Term ' + (i + 1), start: startEl ? startEl.value : '', end: endEl ? endEl.value : '' });
    }
    await apiPost('/academic/config', { year: year, terms });
    closeModal(); render(); toast('Academic settings saved.');
  } catch (e) { toast(e.message); }
}

// ---- SAVE FILES ----
function sizeText(n) { if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; return (n / 1048576).toFixed(1) + " MB"; }
function fileCategory(f) { let ext = (f.name || "").split(".").pop().toLowerCase(); if (ext === "pdf") return "pdf"; if (["doc", "docx"].includes(ext)) return "doc"; if (["xls", "xlsx"].includes(ext)) return "xls"; if (["jpg", "jpeg", "png", "gif"].includes(ext)) return "image"; return "other"; }
function fileCategoryLabel(cat) { return { pdf: "PDF", doc: "Word", xls: "Excel", image: "Image", other: "Document" }[cat] || "File"; }

// ---- MODAL HELPERS ----
function modal(content) { document.getElementById("modal").innerHTML = `<div class="modalbox">${content}</div>`; document.getElementById("modal").classList.remove("hidden"); }
function closeModal() { document.getElementById("modal").classList.add("hidden"); document.getElementById("modal").innerHTML = ""; }
function humanDate(d) { let x = new Date(d), now = new Date(), days = Math.floor((now - x) / 86400000); if (days === 0) return "Today"; if (days === 1) return "Yesterday"; if (days < 7) return days + " days ago"; if (days < 30) return Math.floor(days / 7) + " week(s) ago"; return Math.floor(days / 30) + " month(s) ago"; }

// ---- START ----
init();
