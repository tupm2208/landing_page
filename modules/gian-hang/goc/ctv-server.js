const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");

const MAX_DOWNLOAD_LOGS = 20000;
const SESSION_DAYS = 30;
const REFERRAL_DAYS = 30;
const RESET_MINUTES = 30;
const DEVICE_DAYS = 180;

function createCtvService({ root, readBody, sendJSON, isAdminAuthorized, secureCookieSuffix, sendResetEmail, publicBaseUrl }) {
  const accountsPath = path.join(root, "data", "ctv-accounts.json");
  const sessionsPath = path.join(root, "data", "ctv-sessions.json");
  const logsPath = path.join(root, "data", "ctv-download-log.json");
  // Ban chieu hoa hong tu Sales Desk (nguon su that): {affiliates, commissions, payments, syncedAt}.
  const commissionsPath = path.join(root, "data", "ctv-commissions.json");
  const sessionCookie = "landing_ctv_session";
  const deviceCookie = "landing_ctv_device";
  const referralCookie = "landing_ctv_ref";
  let writeQueue = Promise.resolve();

  async function handle(request, response, url) {
    if (request.method === "GET" && url.searchParams.get("ref")) await captureReferral(response, url.searchParams.get("ref"));
    if (url.pathname === "/api/ctv/login" && request.method === "POST") {
      const result = await login(request, await readBody(request, { limitBytes: 32 * 1024 }));
      if (result.deviceToken) setCookie(response, deviceCookie, result.deviceToken, DEVICE_DAYS * 86400, true);
      if (result.ok) setCookie(response, sessionCookie, result.sessionToken, SESSION_DAYS * 86400, true);
      sendJSON(request, response, result.ok ? { ok: true, data: result.data } : result, result.ok ? 200 : result.status || 401, noStore()); return true;
    }
    if (url.pathname === "/api/ctv/logout" && request.method === "POST") {
      await logout(request); setCookie(response, sessionCookie, "", 0, true); sendJSON(request, response, { ok: true }, 200, noStore()); return true;
    }
    if (url.pathname === "/api/ctv/me" && request.method === "GET") {
      const account = await currentAccount(request);
      // Admin dang nhap duyet web cung thay nut "Tai anh" nhu CTV (khong co code -> khong bat che do gan ref).
      if (!account && isAdminAuthorized(request, url)) { sendJSON(request, response, { ok: true, data: { id: "admin", name: "Admin", allowNoLogo: true, isAdmin: true } }, 200, noStore()); return true; }
      if (!account) { sendJSON(request, response, { ok: false, error: "ctv_session_invalid" }, 401, noStore()); return true; }
      // Mo rong: kem tom tat hoa hong + don gioi thieu + lich su nhan tien cong (chi cua chinh CTV nay).
      const commissionData = await commissionDataForAccount(account);
      sendJSON(request, response, { ok: true, data: { ...publicAccount(account), ...commissionData } }, 200, noStore()); return true;
    }
    if (url.pathname === "/api/ctv/forgot-password" && request.method === "POST") {
      const result = await forgotPassword(await readBody(request, { limitBytes: 32 * 1024 }));
      sendJSON(request, response, result, 200, noStore()); return true;
    }
    if (url.pathname === "/api/ctv/reset-password" && request.method === "POST") {
      const result = await resetPassword(await readBody(request, { limitBytes: 32 * 1024 }));
      sendJSON(request, response, result, result.ok ? 200 : result.status || 400, noStore()); return true;
    }
    if (url.pathname === "/api/ctv/download-log" && request.method === "POST") {
      const account = await currentAccount(request);
      // Luot tai cua admin khong ghi vao log danh gia CTV.
      if (!account && isAdminAuthorized(request, url)) { await readBody(request, { limitBytes: 32 * 1024 }); sendJSON(request, response, { ok: true, data: { logged: false } }, 201, noStore()); return true; }
      if (!account) { sendJSON(request, response, { ok: false, error: "ctv_session_invalid" }, 401, noStore()); return true; }
      const result = await appendDownloadLog(account, await readBody(request, { limitBytes: 32 * 1024 }));
      sendJSON(request, response, result, result.ok ? 201 : result.status || 400, noStore()); return true;
    }
    if (url.pathname === "/api/admin/ctv" && request.method === "GET") {
      if (!isAdminAuthorized(request, url)) return denyAdmin(request, response);
      sendJSON(request, response, { ok: true, data: { accounts: (await readAccounts()).map(adminAccount), logs: await readLogs() } }, 200, noStore()); return true;
    }
    if (url.pathname === "/api/admin/ctv" && request.method === "POST") {
      if (!isAdminAuthorized(request, url)) return denyAdmin(request, response);
      const result = await createAccount(await readBody(request, { limitBytes: 64 * 1024 }));
      sendJSON(request, response, result, result.ok ? 201 : result.status || 400, noStore()); return true;
    }
    if (url.pathname === "/api/admin/ctv/update" && request.method === "POST") {
      if (!isAdminAuthorized(request, url)) return denyAdmin(request, response);
      const result = await updateAccount(await readBody(request, { limitBytes: 64 * 1024 }));
      sendJSON(request, response, result, result.ok ? 200 : result.status || 400, noStore()); return true;
    }
    if (url.pathname === "/api/admin/ctv/delete" && request.method === "POST") {
      if (!isAdminAuthorized(request, url)) return denyAdmin(request, response);
      const result = await deleteAccount(await readBody(request, { limitBytes: 32 * 1024 }));
      sendJSON(request, response, result, result.ok ? 200 : result.status || 400, noStore()); return true;
    }
    if (url.pathname === "/api/admin/ctv/device" && request.method === "POST") {
      if (!isAdminAuthorized(request, url)) return denyAdmin(request, response);
      const result = await updateDevice(await readBody(request, { limitBytes: 32 * 1024 }));
      sendJSON(request, response, result, result.ok ? 200 : result.status || 400, noStore()); return true;
    }
    if (url.pathname === "/api/admin/ctv/sync" && request.method === "POST") {
      if (!isAdminAuthorized(request, url)) return denyAdmin(request, response);
      const result = await syncAccounts(await readBody(request, { limitBytes: 512 * 1024 }));
      sendJSON(request, response, result, result.ok ? 200 : result.status || 400, noStore()); return true;
    }
    if (url.pathname === "/api/admin/ctv/commissions-sync" && request.method === "POST") {
      if (!isAdminAuthorized(request, url)) return denyAdmin(request, response);
      const result = await saveCommissionsSync(await readBody(request, { limitBytes: 5 * 1024 * 1024 }));
      sendJSON(request, response, result, result.ok ? 200 : result.status || 400, noStore()); return true;
    }
    if (url.pathname === "/api/admin/ctv/commissions" && request.method === "GET") {
      if (!isAdminAuthorized(request, url)) return denyAdmin(request, response);
      sendJSON(request, response, { ok: true, data: await readCommissionData() }, 200, noStore()); return true;
    }
    return false;
  }

  async function attributionForRequest(request) {
    const signedInAccount = await currentAccount(request);
    if (signedInAccount) return {
      source: "affiliate_ctv_session",
      affiliateId: signedInAccount.affiliateId || signedInAccount.id,
      affiliateCode: signedInAccount.code,
      affiliateName: signedInAccount.name,
      capturedAt: new Date().toISOString()
    };
    const code = String(cookieValue(request, referralCookie) || "").trim().toUpperCase();
    if (!code) return null;
    const account = (await readAccounts()).find((item) => item.active !== false && item.code === code);
    return account ? { source: "affiliate_link", affiliateId: account.affiliateId || account.id, affiliateCode: account.code, affiliateName: account.name, capturedAt: new Date().toISOString() } : null;
  }

  async function captureReferral(response, rawCode) {
    const code = normalizeCode(rawCode);
    if (!code) return;
    const valid = (await readAccounts()).some((item) => item.active !== false && item.code === code);
    if (valid) setCookie(response, referralCookie, code, REFERRAL_DAYS * 86400, true);
  }

  async function login(request, body = {}) {
    const loginValue = normalizeLogin(body.login || body.username || body.email || body.phone);
    const password = String(body.password || "");
    const account = (await readAccounts()).find((item) => item.active !== false && [item.username, item.email, item.phone].map(normalizeLogin).filter(Boolean).includes(loginValue));
    if (!account || !(await verifyPassword(password, account.passwordHash))) return { ok: false, status: 401, error: "invalid_login", message: "So dien thoai, email hoac mat khau khong dung." };
    const knownToken = cookieValue(request, deviceCookie); const knownHash = knownToken ? hashToken(knownToken) : ""; let device = (account.devices || []).find((item) => item.tokenHash === knownHash);
    if (!device || device.status !== "approved") {
      const deviceToken = knownToken || crypto.randomBytes(32).toString("base64url");
      await queueWrite(async()=>{const accounts=await readAccounts();const target=accounts.find((item)=>item.id===account.id);if(!target)return;target.devices=Array.isArray(target.devices)?target.devices:[];device=target.devices.find((item)=>item.tokenHash===hashToken(deviceToken));if(!device){device={id:`device_${crypto.randomBytes(8).toString("hex")}`,tokenHash:hashToken(deviceToken),status:"pending",label:deviceLabel(request),userAgent:String(request.headers["user-agent"]||"").slice(0,300),ip:maskedIp(request),requestedAt:new Date().toISOString()};target.devices.unshift(device);target.devices=target.devices.slice(0,20);}else if(device.status!=="pending"){device.status="pending";device.requestedAt=new Date().toISOString();delete device.reviewedAt;}await writeJson(accountsPath,accounts);});
      return {ok:false,status:403,error:"device_pending",message:"Thiet bi moi dang cho quan tri vien duyet. Sau khi duoc duyet, hay dang nhap lai.",deviceToken};
    }
    const token = crypto.randomBytes(32).toString("base64url");
    await queueWrite(async () => {
      const sessions = (await readSessions()).filter((item) => item.expiresAt > new Date().toISOString());
      sessions.push({ accountId: account.id, deviceId: device.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(), createdAt: new Date().toISOString() });
      await writeJson(sessionsPath, sessions.slice(-5000));
    });
    return { ok: true, data: publicAccount(account), sessionToken: token };
  }

  async function logout(request) {
    const token = cookieValue(request, sessionCookie); if (!token) return;
    await queueWrite(async () => writeJson(sessionsPath, (await readSessions()).filter((item) => item.tokenHash !== hashToken(token))));
  }

  async function currentAccount(request) {
    const token = cookieValue(request, sessionCookie); if (!token) return null;
    const session = (await readSessions()).find((item) => item.tokenHash === hashToken(token) && item.expiresAt > new Date().toISOString());
    if (!session) return null;
    const account = (await readAccounts()).find((item) => item.id === session.accountId && item.active !== false) || null;
    if (!account || (session.deviceId && !(account.devices || []).some((item) => item.id === session.deviceId && item.status === "approved"))) return null;
    return account;
  }

  async function forgotPassword(body = {}) {
    const email = normalizeEmail(body.email); const account = (await readAccounts()).find((item) => item.active !== false && item.email === email);
    if (!account) return { ok: true, message: "Neu email hop le, he thong da gui lien ket dat lai mat khau." };
    const token = crypto.randomBytes(32).toString("base64url");
    await queueWrite(async () => {
      const accounts = await readAccounts(); const target = accounts.find((item) => item.id === account.id);
      target.resetTokenHash = hashToken(token); target.resetTokenExpiresAt = new Date(Date.now() + RESET_MINUTES * 60000).toISOString(); await writeJson(accountsPath, accounts);
    });
    const resetUrl = `${String(publicBaseUrl()).replace(/\/$/, "")}/ctv-login?reset=${encodeURIComponent(token)}`;
    await sendResetEmail(account.email, resetUrl, account.name || account.username);
    return { ok: true, message: "Neu email hop le, he thong da gui lien ket dat lai mat khau." };
  }

  async function resetPassword(body = {}) {
    const tokenHash = hashToken(body.token); const password = String(body.password || "");
    if (password.length < 8) return { ok: false, status: 422, error: "weak_password", message: "Mat khau can it nhat 8 ky tu." };
    let changed = false;
    await queueWrite(async () => {
      const accounts = await readAccounts(); const account = accounts.find((item) => item.resetTokenHash === tokenHash && item.resetTokenExpiresAt > new Date().toISOString());
      if (!account) return;
      account.passwordHash = await hashPassword(password); account.passwordHashUpdatedAt = new Date().toISOString(); delete account.resetTokenHash; delete account.resetTokenExpiresAt; changed = true;
      await writeJson(accountsPath, accounts); await writeJson(sessionsPath, (await readSessions()).filter((item) => item.accountId !== account.id));
    });
    return changed ? { ok: true } : { ok: false, status: 400, error: "reset_token_invalid", message: "Lien ket dat lai mat khau khong hop le hoac da het han." };
  }

  async function createAccount(body = {}) {
    const account = normalizeIncomingAccount(body); const password = String(body.password || "");
    if ((!account.email && !account.phone) || password.length < 8) return { ok: false, status: 422, error: "invalid_ctv_account", message: "Can so dien thoai hoac email, kem mat khau ban dau tu 8 ky tu." };
    account.name=account.name||account.phone||account.email;account.username=account.username||account.phone||account.email;
    account.id = account.id || `ctv_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`; account.passwordHash = await hashPassword(password); account.passwordHashUpdatedAt = new Date().toISOString(); account.createdAt = new Date().toISOString();
    let duplicate = false;
    await queueWrite(async () => {
      const accounts = await readAccounts();
      account.code=uniqueReferralCode(accounts,account.code);duplicate=accounts.some((item)=>(account.email&&item.email===account.email)||(account.phone&&normalizePhone(item.phone)===normalizePhone(account.phone))||item.username===account.username);
      if (duplicate) return;
      accounts.push(account);
      await writeJson(accountsPath, accounts);
    });
    if (duplicate) return { ok: false, status: 409, error: "ctv_duplicate", message: "So dien thoai hoac email da duoc dung cho tai khoan CTV khac." };
    return { ok: true, data: adminAccount(account) };
  }
  async function updateDevice(body={}){const accountId=String(body.accountId||"").trim(),deviceId=String(body.deviceId||"").trim(),action=String(body.action||"").trim();let updated=null;if(!accountId||!deviceId||!["approve","reject","revoke"].includes(action))return{ok:false,status:422,error:"invalid_device_action"};await queueWrite(async()=>{const accounts=await readAccounts(),account=accounts.find((item)=>item.id===accountId),device=account?.devices?.find((item)=>item.id===deviceId);if(!device)return;device.status=action==="approve"?"approved":action==="reject"?"rejected":"revoked";device.reviewedAt=new Date().toISOString();if(action==="approve")device.approvedAt=device.reviewedAt;await writeJson(accountsPath,accounts);updated=adminDevice(device);});return updated?{ok:true,data:updated}:{ok:false,status:404,error:"ctv_device_not_found",message:"Khong tim thay thiet bi CTV."};}

  async function updateAccount(body = {}) {
    const id = String(body.id || "").trim(); let updated = null;
    await queueWrite(async () => { const accounts = await readAccounts(); const account = accounts.find((item) => item.id === id); if (!account) return; ["name","phone","email","username","code","affiliateId"].forEach((field) => { if (body[field] !== undefined) account[field] = field === "email" ? normalizeEmail(body[field]) : field === "code" ? normalizeCode(body[field]) : String(body[field] || "").trim(); }); if (typeof body.active === "boolean") account.active = body.active; if (typeof body.allowNoLogo === "boolean") account.allowNoLogo = body.allowNoLogo; if (body.password && String(body.password).length >= 8) { account.passwordHash = await hashPassword(body.password); account.passwordHashUpdatedAt = new Date().toISOString(); } updated = adminAccount(account); await writeJson(accountsPath, accounts); });
    return updated ? { ok: true, data: updated } : { ok: false, status: 404, error: "ctv_not_found" };
  }

  async function deleteAccount(body = {}) {
    const id = String(body.id || "").trim(); let removed = null;
    if (!id) return { ok: false, status: 422, error: "invalid_ctv_id" };
    await queueWrite(async () => {
      const accounts = await readAccounts(); const account = accounts.find((item) => item.id === id);
      if (!account) return;
      removed = adminAccount(account);
      await writeJson(accountsPath, accounts.filter((item) => item.id !== id));
      await writeJson(sessionsPath, (await readSessions()).filter((item) => item.accountId !== id));
    });
    return removed ? { ok: true, data: removed } : { ok: false, status: 404, error: "ctv_not_found", message: "Khong tim thay tai khoan CTV." };
  }

  async function syncAccounts(body = {}) {
    const incoming = Array.isArray(body.accounts) ? body.accounts : []; const current = await readAccounts(); const byAffiliate = new Map(current.map((item) => [item.affiliateId || item.id, item]));
    for (const raw of incoming) {
      const normalized = normalizeIncomingAccount(raw);
      if (!normalized.affiliateId || !normalized.code) continue;
      // Khong khop affiliateId thi thu khop code/email/username/phone -> ADOPT affiliateId tu Desk
      // (va lo hong CTV tao tu landing bi nhan doi khi Desk sync xuong).
      const existing = byAffiliate.get(normalized.affiliateId) || current.find((item) => item.code === normalized.code || (normalized.email && item.email === normalized.email) || (normalized.username && item.username === normalized.username) || (normalized.phone && normalizePhone(item.phone) === normalized.phone));
      if (existing) {
        const localId = existing.id;
        const localDevices = existing.devices;
        const localPasswordHash = existing.passwordHash;
        const localPasswordAt = String(existing.passwordHashUpdatedAt || "");
        const localEmail = existing.email;
        const localPhone = existing.phone;
        const adopting = String(existing.affiliateId || "") !== String(normalized.affiliateId || "");
        const remotePasswordAt = String(raw.passwordHashUpdatedAt || "");
        Object.assign(existing, normalized);
        existing.id = localId;
        existing.devices = localDevices;
        // Desk co the thieu email/phone (tai khoan chi-co-SDT): khong de sync xoa trang lien he local.
        if (!existing.email && localEmail) existing.email = localEmail;
        if (!existing.phone && localPhone) existing.phone = localPhone;
        byAffiliate.set(normalized.affiliateId, existing);
        if (adopting || !raw.passwordHash || localPasswordAt > remotePasswordAt) {
          existing.passwordHash = localPasswordHash;
          // Danh dau mat khau local "moi hon" ban placeholder tu Desk de cac lan sync sau khong ghi de.
          existing.passwordHashUpdatedAt = adopting && localPasswordHash ? new Date().toISOString() : localPasswordAt;
        }
      } else if (raw.passwordHash) {
        const created = { ...normalized, id: raw.id || `ctv_${crypto.randomBytes(8).toString("hex")}`, passwordHash: raw.passwordHash, passwordHashUpdatedAt: raw.passwordHashUpdatedAt || new Date().toISOString(), createdAt: raw.createdAt || new Date().toISOString() };
        current.push(created);
        byAffiliate.set(created.affiliateId || created.id, created);
      }
    }
    await queueWrite(() => writeJson(accountsPath, current)); return { ok: true, count: incoming.length };
  }

  async function readCommissionData() {
    const value = await readJson(commissionsPath, null);
    if (!value || typeof value !== "object") return { affiliates: [], commissions: [], payments: [], syncedAt: "" };
    return {
      affiliates: Array.isArray(value.affiliates) ? value.affiliates : [],
      commissions: Array.isArray(value.commissions) ? value.commissions : [],
      payments: Array.isArray(value.payments) ? value.payments : [],
      syncedAt: String(value.syncedAt || "")
    };
  }

  async function saveCommissionsSync(body = {}) {
    const data = {
      affiliates: Array.isArray(body.affiliates) ? body.affiliates : [],
      commissions: Array.isArray(body.commissions) ? body.commissions : [],
      payments: Array.isArray(body.payments) ? body.payments : [],
      syncedAt: new Date().toISOString()
    };
    await queueWrite(() => writeJson(commissionsPath, data));
    return { ok: true, count: data.commissions.length, syncedAt: data.syncedAt };
  }

  // Loc dung du lieu cua 1 CTV (khop affiliateId hoac code) cho /api/ctv/me.
  async function commissionDataForAccount(account = {}) {
    const data = await readCommissionData();
    const affiliateId = String(account.affiliateId || account.id || "");
    const code = String(account.code || "").trim().toUpperCase();
    const matches = (item) => (affiliateId && String(item.affiliateId || "") === affiliateId)
      || (code && String(item.affiliateCode || "").trim().toUpperCase() === code);
    const orders = data.commissions.filter(matches);
    const payments = data.payments.filter(matches);
    const sumBy = (list) => list.reduce((total, item) => total + Math.max(0, Number(item.commissionAmount || 0)), 0);
    const paidAmount = payments.reduce((total, item) => total + Math.max(0, Number(item.amount || 0)), 0);
    return {
      commissionSummary: {
        pendingAmount: sumBy(orders.filter((item) => !["approved", "void"].includes(String(item.status || "pending")))),
        approvedAmount: sumBy(orders.filter((item) => String(item.status || "") === "approved")),
        paidAmount,
        orderCount: orders.length
      },
      orders,
      payments,
      commissionsSyncedAt: data.syncedAt
    };
  }

  async function appendDownloadLog(account, body = {}) { const productCode = String(body.productCode || "").trim().slice(0,100); const imageIndex = Number(body.imageIndex); if (!productCode || !Number.isFinite(imageIndex)) return { ok:false,status:422,error:"invalid_download_log" }; await queueWrite(async()=>{const logs=await readJson(logsPath,[]);logs.push({ctvId:account.id,productCode,imageIndex,at:new Date().toISOString()});await writeJson(logsPath,logs.slice(-MAX_DOWNLOAD_LOGS));});return {ok:true}; }
  async function readAccounts(){const value=await readJson(accountsPath,[]);return Array.isArray(value)?value.map(normalizeStoredAccount).filter(Boolean):[];} async function readSessions(){const value=await readJson(sessionsPath,[]);return Array.isArray(value)?value:[];} async function readLogs(){const value=await readJson(logsPath,[]);return Array.isArray(value)?value.slice(-MAX_DOWNLOAD_LOGS).reverse():[];}
  function denyAdmin(request,response){sendJSON(request,response,{ok:false,error:"admin_login_required"},401,noStore());return true;} function queueWrite(task){writeQueue=writeQueue.then(task,task);return writeQueue;}
  async function readJson(filePath,fallback){try{return JSON.parse(await fsp.readFile(filePath,"utf8"));}catch{return fallback;}} async function writeJson(filePath,value){await fsp.mkdir(path.dirname(filePath),{recursive:true});const tmp=`${filePath}.${process.pid}.${Date.now()}.tmp`;await fsp.writeFile(tmp,JSON.stringify(value,null,2),"utf8");await fsp.rename(tmp,filePath);}
  function setCookie(response,name,value,maxAge,httpOnly){const existing=response.getHeader("Set-Cookie");const cookie=`${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly?"; HttpOnly":""}${secureCookieSuffix()}`;response.setHeader("Set-Cookie",existing?[].concat(existing,cookie):cookie);}
  return { handle, currentAccount, attributionForRequest };
}

function normalizeIncomingAccount(raw={}){return {id:String(raw.id||"").trim(),affiliateId:String(raw.affiliateId||raw.id||"").trim(),name:String(raw.name||"").trim().slice(0,120),phone:normalizePhone(raw.phone||raw.contact),email:normalizeEmail(raw.email),username:String(raw.username||"").trim().toLowerCase().slice(0,190),code:normalizeCode(raw.code),active:raw.active!==false&&raw.status!=="inactive",allowNoLogo:Boolean(raw.allowNoLogo),devices:Array.isArray(raw.devices)?raw.devices.map(normalizeDevice).filter(Boolean):[],passwordHash:String(raw.passwordHash||""),passwordHashUpdatedAt:String(raw.passwordHashUpdatedAt||""),createdAt:String(raw.createdAt||"")};}
function normalizeStoredAccount(raw){const item=normalizeIncomingAccount(raw);return item.id&&item.code?{...raw,...item}:null;} function publicAccount(a){return {id:a.id,affiliateId:a.affiliateId||a.id,name:a.name,email:a.email,username:a.username,code:a.code,allowNoLogo:Boolean(a.allowNoLogo)};} function adminAccount(a){return {...publicAccount(a),phone:a.phone||"",active:a.active!==false,createdAt:a.createdAt||"",devices:(a.devices||[]).map(adminDevice)};}
function normalizeDevice(raw={}){const id=String(raw.id||"").trim();return id?{id,tokenHash:String(raw.tokenHash||""),status:["pending","approved","rejected","revoked"].includes(raw.status)?raw.status:"pending",label:String(raw.label||"").slice(0,120),userAgent:String(raw.userAgent||"").slice(0,300),ip:String(raw.ip||"").slice(0,80),requestedAt:String(raw.requestedAt||""),approvedAt:String(raw.approvedAt||""),reviewedAt:String(raw.reviewedAt||"")}:null;}function adminDevice(d){return{id:d.id,status:d.status,label:d.label,userAgent:d.userAgent,ip:d.ip,requestedAt:d.requestedAt,approvedAt:d.approvedAt,reviewedAt:d.reviewedAt};}
function normalizeEmail(v){return String(v||"").trim().toLowerCase().slice(0,190);} function normalizeCode(v){return String(v||"").trim().toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,40);} function hashToken(v){return crypto.createHash("sha256").update(String(v||"")).digest("hex");}
function normalizePhone(v){return String(v||"").replace(/\D/g,"").slice(0,15);}function normalizeLogin(v){const raw=String(v||"").trim().toLowerCase();return raw.includes("@")?raw:normalizePhone(raw)||raw;}function uniqueReferralCode(accounts,preferred){let code=normalizeCode(preferred);while(!code||(accounts||[]).some((item)=>item.code===code))code=`CTV${crypto.randomBytes(4).toString("hex").toUpperCase()}`;return code;}function deviceLabel(request){const ua=String(request.headers["user-agent"]||"");const browser=/Edg\//.test(ua)?"Edge":/Chrome\//.test(ua)?"Chrome":/Firefox\//.test(ua)?"Firefox":/Safari\//.test(ua)?"Safari":"Trinh duyet";const os=/Android/.test(ua)?"Android":/iPhone|iPad/.test(ua)?"iPhone/iPad":/Windows/.test(ua)?"Windows":/Mac OS/.test(ua)?"macOS":"Thiet bi";return `${browser} - ${os}`;}function maskedIp(request){const raw=String(request.headers["x-forwarded-for"]||request.socket?.remoteAddress||"").split(",")[0].trim();if(raw.includes(".")){const parts=raw.split(".");return `${parts[0]||"x"}.${parts[1]||"x"}.x.x`;}return raw?`${raw.slice(0,8)}...`:"";}
function cookieValue(request,name){for(const part of String(request.headers.cookie||"").split(";")){const index=part.indexOf("=");if(index>0&&part.slice(0,index).trim()===name)return decodeURIComponent(part.slice(index+1).trim());}return "";} function noStore(){return {"Cache-Control":"no-store"};}
function hashPassword(password){return new Promise((resolve,reject)=>{const salt=crypto.randomBytes(16).toString("base64url");const iterations=210000;crypto.pbkdf2(String(password),salt,iterations,32,"sha256",(error,key)=>error?reject(error):resolve(`pbkdf2$${iterations}$${salt}$${key.toString("base64url")}`));});}
function verifyPassword(password,stored){return new Promise((resolve)=>{const [method,iterationText,salt,hash]=String(stored||"").split("$");const iterations=Number(iterationText);if(method!=="pbkdf2"||!iterations||!salt||!hash)return resolve(false);crypto.pbkdf2(String(password),salt,iterations,32,"sha256",(error,key)=>{if(error)return resolve(false);const expected=Buffer.from(hash,"base64url");resolve(expected.length===key.length&&crypto.timingSafeEqual(expected,key));});});}

module.exports={createCtvService};
