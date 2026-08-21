import React, { useState, useEffect, useRef, useCallback } from "react";
import { Shield, MapPin, Users, Phone, X, Check, AlertTriangle, Radio, ChevronRight, UserPlus, Clock } from "lucide-react";
import { pushUserLiveAlert, clearUserLiveAlert, subscribeAllUsers } from "./firebase";

// ---------- Helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10);

const fmtTime = (ts) => {
  const d = new Date(ts);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const fmtElapsed = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

// Demo contacts (Fizza / Shahmeer / Bilal per the user's own test setup)
const DEFAULT_CONTACTS = [
  { id: uid(), name: "Fizza (épouse)", role: "Contact principal", initials: "FZ", phone: "" },
  { id: uid(), name: "Shahmeer (époux)", role: "Contact principal", initials: "SH", phone: "" },
  { id: uid(), name: "Bilal (frère)", role: "Contact secondaire", initials: "BL", phone: "" },
];

const CONTACTS_KEY = "rakhwaal_contacts_v1";

const loadContacts = () => {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* localStorage unavailable — fall back to defaults */
  }
  return DEFAULT_CONTACTS;
};

const saveContacts = (contacts) => {
  try {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
  } catch (e) {
    /* ignore persistence failures */
  }
};

const initialsOf = (name) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("") || "?";

const digitsOnly = (phone) => (phone || "").replace(/[^\d]/g, "");

// Builds a WhatsApp deep link whose message points to the app's own
// "Famille" live-tracking view, so it can be sent immediately at SOS time
// without waiting for a GPS fix (the link itself updates live afterwards).
const buildWaUrl = (contact, senderName) => {
  if (!contact.phone) return null;
  const appUrl = typeof window !== "undefined" ? window.location.origin : "";
  const text = `🚨 Alerte SOS Rakhwaal — ${senderName || "Un proche"} a besoin d'aide. Suivez sa position en direct ici : ${appUrl}`;
  return `https://wa.me/${contact.phone}?text=${encodeURIComponent(text)}`;
};

// ---------- Identity (no login — a locally-remembered "who is using this device") ----------
const IDENTITY_KEY = "rakhwaal_identity_v1";

const IDENTITY_PRESETS = [
  { id: "shahmeer", name: "Shahmeer", initials: "SH" },
  { id: "fizza", name: "Fizza", initials: "FZ" },
  { id: "bilal", name: "Bilal", initials: "BL" },
];

const loadIdentity = () => {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* ignore */
  }
  return null;
};

const saveIdentity = (identity) => {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch (e) {
    /* ignore */
  }
};

const clearIdentity = () => {
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch (e) {
    /* ignore */
  }
};

export default function RakhwaalApp() {
  const [identity, setIdentity] = useState(loadIdentity);
  const [view, setView] = useState("user"); // "user" | "family"
  const [status, setStatus] = useState("safe"); // "safe" | "arming" | "active"
  const [holdProgress, setHoldProgress] = useState(0);
  const [position, setPosition] = useState(null);
  const [alertStart, setAlertStart] = useState(null);
  const [pathTrail, setPathTrail] = useState([]);
  const [contacts, setContacts] = useState(loadContacts);
  const [locError, setLocError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [allUsers, setAllUsers] = useState({}); // data read from Firebase — every family member's live status

  // Subscribe once to the shared Firebase channel so the "Famille" view
  // reflects every device that has an identity set on this link.
  useEffect(() => {
    const unsubscribe = subscribeAllUsers(setAllUsers);
    return unsubscribe;
  }, []);

  useEffect(() => {
    saveContacts(contacts);
  }, [contacts]);

  const addContact = (name, phone) => {
    setContacts((prev) => [
      ...prev,
      { id: uid(), name, phone: digitsOnly(phone), role: "Contact d'urgence", initials: initialsOf(name) },
    ]);
  };

  const removeContact = (id) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  };

  const updateContactPhone = (id, phone) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, phone: digitsOnly(phone) } : c)));
  };

  const holdTimer = useRef(null);
  const holdInterval = useRef(null);
  const watchId = useRef(null);
  const HOLD_MS = 1800;

  // Tick clock for elapsed-time display
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Geolocation watcher — active continuously once alert is triggered
  useEffect(() => {
    if (status !== "active" || !identity) return;
    if (!navigator.geolocation) {
      setLocError("blocked");
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const point = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ts: Date.now(),
        };
        setPosition(point);
        setPathTrail((prev) => {
          const nextTrail = [...prev.slice(-49), point];
          pushUserLiveAlert(identity.id, {
            name: identity.name,
            status: "active",
            position: point,
            trail: nextTrail,
            alertStart: alertStart || Date.now(),
            updatedAt: Date.now(),
          });
          return nextTrail;
        });
        setLocError(null);
      },
      (err) => {
        // code 1 = permission denied, 2 = position unavailable, 3 = timeout
        setLocError(err.code === 1 ? "denied" : "blocked");
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 8000 }
    );
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [status, identity]);

  // Demo fallback: lets the prototype be tested even when the sandboxed
  // preview blocks real geolocation (common inside embedded iframes).
  const useDemoLocation = useCallback(() => {
    if (!identity) return;
    // Karachi, Pakistan (24.85970° N, 67.15353° E) — with tiny jitter so the trail line is visible
    const base = { lat: 24.8597, lng: 67.15353 };
    const point = {
      lat: base.lat + (Math.random() - 0.5) * 0.001,
      lng: base.lng + (Math.random() - 0.5) * 0.001,
      accuracy: 12,
      ts: Date.now(),
      demo: true,
    };
    setPosition(point);
    setPathTrail((prev) => {
      const nextTrail = [...prev.slice(-49), point];
      pushUserLiveAlert(identity.id, {
        name: identity.name,
        status: "active",
        position: point,
        trail: nextTrail,
        alertStart: alertStart || Date.now(),
        updatedAt: Date.now(),
      });
      return nextTrail;
    });
  }, [alertStart, identity]);

  useEffect(() => {
    if (status !== "active" || !locError) return;
    // auto-generate a demo trail so "Famille" view has something to show
    useDemoLocation();
    const t = setInterval(useDemoLocation, 4000);
    return () => clearInterval(t);
  }, [status, locError, useDemoLocation]);

  const startHold = useCallback(() => {
    if (status === "active") return;
    setStatus("arming");
    setHoldProgress(0);
    const startedAt = Date.now();
    holdInterval.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - startedAt) / HOLD_MS) * 100);
      setHoldProgress(pct);
    }, 30);
    holdTimer.current = setTimeout(() => {
      setStatus("active");
      setAlertStart(Date.now());
      setHoldProgress(100);
      clearInterval(holdInterval.current);
      if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 200]);

      // Auto-open a WhatsApp draft per contact with a saved number.
      // Browsers may block more than one automatic popup — any that get
      // blocked still have a manual "Envoyer" button in the alert panel.
      contacts
        .filter((c) => c.phone)
        .forEach((c, i) => {
          const url = buildWaUrl(c, identity?.name);
          if (!url) return;
          setTimeout(() => {
            const win = window.open(url, "_blank");
            if (!win) {
              console.warn(`Popup bloqué pour ${c.name} — utiliser le bouton manuel.`);
            }
          }, i * 250);
        });
    }, HOLD_MS);
  }, [status, contacts, identity]);

  const cancelHold = useCallback(() => {
    if (status === "arming") {
      clearTimeout(holdTimer.current);
      clearInterval(holdInterval.current);
      setStatus("safe");
      setHoldProgress(0);
    }
  }, [status]);

  const resolveAlert = () => {
    setStatus("safe");
    setAlertStart(null);
    setPathTrail([]);
    setPosition(null);
    setHoldProgress(0);
    if (identity) clearUserLiveAlert(identity.id, identity.name);
  };

  const chooseIdentity = (person) => {
    saveIdentity(person);
    setIdentity(person);
  };

  const switchIdentity = () => {
    clearIdentity();
    setIdentity(null);
    setStatus("safe");
    setAlertStart(null);
    setPathTrail([]);
    setPosition(null);
  };

  if (!identity) {
    return (
      <div style={styles.app}>
        <style>{fontImport}</style>
        <IdentityPicker contacts={contacts} onChoose={chooseIdentity} />
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <style>{fontImport}</style>
      <TopBar view={view} setView={setView} status={status} identity={identity} onSwitchIdentity={switchIdentity} />
      {view === "user" ? (
        <UserView
          status={status}
          holdProgress={holdProgress}
          onStart={startHold}
          onCancel={cancelHold}
          onResolve={resolveAlert}
          position={position}
          alertStart={alertStart}
          now={now}
          locError={locError}
          contacts={contacts}
          identity={identity}
          onManageContacts={() => setShowContactsModal(true)}
        />
      ) : (
        <FamilyView
          allUsers={allUsers}
          currentUserId={identity.id}
          contacts={contacts}
        />
      )}
      {showContactsModal && (
        <ContactsModal
          contacts={contacts}
          onAdd={addContact}
          onRemove={removeContact}
          onUpdatePhone={updateContactPhone}
          onClose={() => setShowContactsModal(false)}
        />
      )}
    </div>
  );
}

// ---------------- Top bar ----------------
function TopBar({ view, setView, status, identity, onSwitchIdentity }) {
  return (
    <div style={styles.topbar}>
      <div style={styles.brand}>
        <Shield size={20} color={colors.sand} strokeWidth={2.2} />
        <span style={styles.brandText}>Rakhwaal</span>
      </div>
      <div style={styles.topbarRight}>
        <div style={styles.tabSwitch}>
          <button
            onClick={() => setView("user")}
            style={{ ...styles.tabBtn, ...(view === "user" ? styles.tabBtnActive : {}) }}
          >
            Moi
          </button>
          <button
            onClick={() => setView("family")}
            style={{ ...styles.tabBtn, ...(view === "family" ? styles.tabBtnActive : {}) }}
          >
            Famille
            {status === "active" && <span style={styles.dotAlert} />}
          </button>
        </div>
        <button style={styles.identityBadge} onClick={onSwitchIdentity} title="Changer d'identité">
          {identity.initials}
        </button>
      </div>
    </div>
  );
}

// ---------------- Identity picker (first launch) ----------------
function IdentityPicker({ contacts, onChoose }) {
  const [customName, setCustomName] = useState("");

  return (
    <div style={styles.identityWrap}>
      <Shield size={36} color={colors.sand} strokeWidth={1.8} />
      <div style={styles.identityTitle}>Rakhwaal</div>
      <div style={styles.identitySub}>Qui utilise cet appareil ?</div>

      <div style={styles.identityList}>
        {IDENTITY_PRESETS.map((p) => (
          <button key={p.id} style={styles.identityOption} onClick={() => onChoose(p)}>
            <div style={styles.avatarSm}>{p.initials}</div>
            <span>{p.name}</span>
            <ChevronRight size={16} color={colors.muted} style={{ marginLeft: "auto" }} />
          </button>
        ))}
      </div>

      <div style={styles.identityCustomRow}>
        <input
          type="text"
          placeholder="Autre nom…"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          style={styles.modalInput}
        />
        <button
          style={styles.identityCustomBtn}
          onClick={() => {
            const trimmed = customName.trim();
            if (!trimmed) return;
            onChoose({ id: trimmed.toLowerCase().replace(/\s+/g, "-") + "-" + uid().slice(0, 4), name: trimmed, initials: initialsOf(trimmed) });
          }}
        >
          OK
        </button>
      </div>

      <p style={styles.identityHint}>
        Pas de mot de passe pour l'instant — juste pour savoir qui déclenche une alerte pendant les tests.
      </p>
    </div>
  );
}

// ---------------- User view ----------------
function UserView({ status, holdProgress, onStart, onCancel, onResolve, position, alertStart, now, locError, contacts, identity, onManageContacts }) {
  return (
    <div style={styles.userWrap}>
      {status !== "active" ? (
        <>
          <div style={styles.statusPill(status)}>
            {status === "safe" ? (
              <>
                <Check size={14} /> Vous êtes en sécurité
              </>
            ) : (
              <>
                <Clock size={14} /> Maintenez pour confirmer…
              </>
            )}
          </div>

          <div style={styles.sosZone}>
            <button
              onMouseDown={onStart}
              onMouseUp={onCancel}
              onMouseLeave={onCancel}
              onTouchStart={(e) => {
                e.preventDefault();
                onStart();
              }}
              onTouchEnd={onCancel}
              style={{
                ...styles.sosButton,
                ...(status === "arming" ? styles.sosButtonArming : {}),
              }}
              aria-label="Maintenir pour déclencher l'alerte SOS"
            >
              <svg width="220" height="220" style={{ position: "absolute", inset: 0 }}>
                <circle
                  cx="110"
                  cy="110"
                  r="102"
                  fill="none"
                  stroke="rgba(232,56,79,0.18)"
                  strokeWidth="6"
                />
                <circle
                  cx="110"
                  cy="110"
                  r="102"
                  fill="none"
                  stroke={colors.alert}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 102}
                  strokeDashoffset={2 * Math.PI * 102 * (1 - holdProgress / 100)}
                  transform="rotate(-90 110 110)"
                  style={{ transition: "stroke-dashoffset 30ms linear" }}
                />
              </svg>
              <div style={styles.sosInner}>
                <AlertTriangle size={36} strokeWidth={2} />
                <span style={styles.sosLabel}>SOS</span>
              </div>
            </button>
          </div>

          <p style={styles.hint}>
            Appui court = armé · Maintien {`~2s`} = alerte envoyée à vos proches
          </p>

          <div style={styles.contactsPreview}>
            <div style={styles.contactsPreviewHeader}>
              <Users size={14} color={colors.muted} />
              <span>Vos contacts d'urgence</span>
              <button style={styles.manageLink} onClick={onManageContacts}>
                Gérer
              </button>
            </div>
            <div style={styles.avatarRow}>
              {contacts.map((c) => (
                <div key={c.id} style={styles.avatar} title={c.name}>
                  {c.initials}
                </div>
              ))}
              <button style={styles.avatarAdd} onClick={onManageContacts} aria-label="Ajouter un contact">
                <UserPlus size={14} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <ActiveAlertPanel
          position={position}
          alertStart={alertStart}
          now={now}
          locError={locError}
          onResolve={onResolve}
          contacts={contacts}
          identity={identity}
        />
      )}
    </div>
  );
}

function ActiveAlertPanel({ position, alertStart, now, locError, onResolve, contacts, identity }) {
  return (
    <div style={styles.activePanel}>
      <div style={styles.activeHeader}>
        <div style={styles.pulseDot} />
        <div>
          <div style={styles.activeTitle}>Alerte active</div>
          <div style={styles.activeSub}>Envoyée à {contacts.length} contacts · {fmtElapsed(alertStart || now)}</div>
        </div>
      </div>

      <div style={styles.mapPlaceholder}>
        <MapPin size={26} color={colors.alert} />
        {position ? (
          <>
            <div style={styles.coords}>
              {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            </div>
            <div style={styles.coordsSub}>
              {position.demo
                ? "position de démo · GPS réel bloqué dans cet aperçu"
                : `précision ±${Math.round(position.accuracy)}m · mis à jour ${fmtTime(position.ts)}`}
            </div>
          </>
        ) : locError === "denied" ? (
          <div style={styles.coordsSub}>
            Permission refusée — autorise la localisation dans les réglages du navigateur, puis relance l'alerte.
          </div>
        ) : locError === "blocked" ? (
          <div style={styles.coordsSub}>
            GPS indisponible dans cet aperçu (sandbox) — position de démo utilisée à la place.
          </div>
        ) : (
          <div style={styles.coordsSub}>Recherche du signal GPS…</div>
        )}
      </div>

      <div style={styles.notifiedList}>
        {contacts.map((c) => {
          const waUrl = buildWaUrl(c, identity?.name);
          return (
            <div key={c.id} style={styles.notifiedRow}>
              <div style={styles.avatarSm}>{c.initials}</div>
              <div style={{ flex: 1 }}>
                <div style={styles.notifiedName}>{c.name}</div>
                <div style={styles.notifiedStatus}>
                  {c.phone ? "Message WhatsApp ouvert · appuie sur Envoyer" : "Pas de numéro — ajoute-le dans Gérer"}
                </div>
              </div>
              {waUrl ? (
                <a href={waUrl} target="_blank" rel="noreferrer" style={styles.waBtn} aria-label={`Envoyer sur WhatsApp à ${c.name}`}>
                  <Phone size={14} />
                </a>
              ) : (
                <Check size={16} color={colors.mutedDeep} />
              )}
            </div>
          );
        })}
      </div>

      <button style={styles.resolveBtn} onClick={onResolve}>
        <Check size={16} /> Je suis en sécurité — annuler l'alerte
      </button>
    </div>
  );
}

// ---------------- Family view ----------------
function FamilyView({ allUsers, currentUserId, contacts }) {
  const [now, setNow] = useState(Date.now());
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const entries = Object.entries(allUsers || {}).map(([id, data]) => ({ id, ...data }));
  const activeUsers = entries.filter((u) => u.status === "active");
  const safeUsers = entries.filter((u) => u.status !== "active");

  // Auto-select the first active user (or keep selection if still active)
  useEffect(() => {
    if (activeUsers.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!activeUsers.find((u) => u.id === selectedId)) {
      setSelectedId(activeUsers[0].id);
    }
  }, [allUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = activeUsers.find((u) => u.id === selectedId) || activeUsers[0] || null;

  return (
    <div style={styles.familyWrap}>
      {activeUsers.length > 0 ? (
        <>
          {activeUsers.length > 1 && (
            <div style={styles.multiAlertTabs}>
              {activeUsers.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setSelectedId(u.id)}
                  style={{
                    ...styles.multiAlertTab,
                    ...(u.id === selected?.id ? styles.multiAlertTabActive : {}),
                  }}
                >
                  {u.name || "Inconnu"}
                </button>
              ))}
            </div>
          )}

          <div style={styles.familyAlertBanner}>
            <div style={styles.pulseDot} />
            <div>
              <div style={styles.activeTitle}>
                {selected.name || "Quelqu'un"} a déclenché une alerte SOS
              </div>
              <div style={styles.activeSub}>Il y a {fmtElapsed(selected.alertStart || now)}</div>
            </div>
          </div>

          <LiveMapCanvas position={selected.position} trail={selected.trail || []} />

          <div style={styles.actionRow}>
            <a href="tel:15" style={styles.callBtn}>
              <Phone size={16} /> Appeler
            </a>
            {selected.position && (
              <a
                href={`https://www.google.com/maps?q=${selected.position.lat},${selected.position.lng}`}
                target="_blank"
                rel="noreferrer"
                style={styles.mapsBtn}
              >
                <MapPin size={16} /> Ouvrir dans Maps
              </a>
            )}
          </div>

          <div style={styles.trailInfo}>
            <Radio size={14} color={colors.safe} />
            <span>{(selected.trail || []).length} points GPS reçus en direct</span>
          </div>
        </>
      ) : (
        <div style={styles.emptyState}>
          <Shield size={40} color={colors.mutedDeep} strokeWidth={1.5} />
          <div style={styles.emptyTitle}>Aucune alerte active</div>
          <div style={styles.emptySub}>
            Vous serez notifié instantanément si un membre de votre famille déclenche le SOS.
          </div>
          <div style={styles.watchList}>
            {safeUsers.length > 0
              ? safeUsers
                  .filter((u) => u.id !== currentUserId)
                  .map((u) => (
                    <div key={u.id} style={styles.watchRow}>
                      <div style={styles.avatarSm}>{initialsOf(u.name || "?")}</div>
                      <div style={{ flex: 1 }}>
                        <div style={styles.notifiedName}>{u.name || "Inconnu"}</div>
                        <div style={styles.notifiedStatus}>Vu {fmtTime(u.updatedAt || now)}</div>
                      </div>
                      <span style={styles.safeTag}>Sûr</span>
                    </div>
                  ))
              : contacts.map((c) => (
                  <div key={c.id} style={styles.watchRow}>
                    <div style={styles.avatarSm}>{c.initials}</div>
                    <div style={{ flex: 1 }}>
                      <div style={styles.notifiedName}>{c.name}</div>
                      <div style={styles.notifiedStatus}>{c.role}</div>
                    </div>
                    <span style={styles.safeTag}>Sûr</span>
                  </div>
                ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Simple canvas-based live trail — no external maps dependency needed for the prototype
function LiveMapCanvas({ position, trail }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // background grid (stand-in for a map tile until a real maps API is wired in)
    ctx.fillStyle = "#151a27";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(240,230,216,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (trail.length === 0) return;

    const lats = trail.map((p) => p.lat);
    const lngs = trail.map((p) => p.lng);
    const minLat = Math.min(...lats) - 0.0005;
    const maxLat = Math.max(...lats) + 0.0005;
    const minLng = Math.min(...lngs) - 0.0005;
    const maxLng = Math.max(...lngs) + 0.0005;

    const toXY = (p) => {
      const x = ((p.lng - minLng) / (maxLng - minLng || 1)) * (w - 40) + 20;
      const y = h - (((p.lat - minLat) / (maxLat - minLat || 1)) * (h - 40) + 20);
      return [x, y];
    };

    // trail line
    ctx.strokeStyle = colors.safe;
    ctx.lineWidth = 2;
    ctx.beginPath();
    trail.forEach((p, i) => {
      const [x, y] = toXY(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // current position pulse
    if (position) {
      const [x, y] = toXY(position);
      ctx.fillStyle = "rgba(232,56,79,0.25)";
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.alert;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [position, trail]);

  return (
    <div style={styles.canvasWrap}>
      <canvas ref={canvasRef} width={340} height={280} style={styles.canvas} />
      <div style={styles.canvasBadge}>Aperçu · à brancher sur Google Maps / Mapbox</div>
    </div>
  );
}

// ---------------- Contacts manager modal ----------------
function ContactsModal({ contacts, onAdd, onRemove, onUpdatePhone, onClose }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const handleAdd = () => {
    const trimmedName = name.trim();
    const trimmedPhone = digitsOnly(phone);
    if (!trimmedName) {
      setError("Entre un nom.");
      return;
    }
    if (!trimmedPhone || trimmedPhone.length < 8) {
      setError("Entre un numéro WhatsApp valide, avec l'indicatif pays (ex: 92300xxxxxxx).");
      return;
    }
    onAdd(trimmedName, trimmedPhone);
    setName("");
    setPhone("");
    setError("");
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>Contacts d'urgence</span>
          <button style={styles.modalClose} onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div style={styles.modalList}>
          {contacts.length === 0 && (
            <div style={styles.modalEmpty}>Aucun contact pour l'instant. Ajoute-en un ci-dessous.</div>
          )}
          {contacts.map((c) => (
            <div key={c.id} style={styles.modalRow}>
              <div style={styles.avatarSm}>{c.initials}</div>
              <div style={{ flex: 1 }}>
                <div style={styles.notifiedName}>{c.name}</div>
                <input
                  type="tel"
                  placeholder="Numéro WhatsApp (ex: 923001234567)"
                  value={c.phone || ""}
                  onChange={(e) => onUpdatePhone(c.id, e.target.value)}
                  style={styles.modalPhoneInput}
                />
              </div>
              <button style={styles.modalRemoveBtn} onClick={() => onRemove(c.id)} aria-label={`Supprimer ${c.name}`}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <div style={styles.modalAddSection}>
          <div style={styles.modalAddTitle}>Ajouter un contact</div>
          <input
            type="text"
            placeholder="Nom"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.modalInput}
          />
          <input
            type="tel"
            placeholder="Numéro WhatsApp avec indicatif (ex: 923001234567)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={styles.modalInput}
          />
          {error && <div style={styles.modalError}>{error}</div>}
          <button style={styles.modalAddBtn} onClick={handleAdd}>
            <UserPlus size={15} /> Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Design tokens ----------------
const colors = {
  bg: "#12151F",
  bgElevated: "#1A1F2E",
  sand: "#F0E6D8",
  muted: "#9BA0B0",
  mutedDeep: "#5A5F70",
  alert: "#E8384F",
  alertDim: "rgba(232,56,79,0.14)",
  safe: "#3FA796",
  border: "rgba(240,230,216,0.08)",
};

const fontImport = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
`;

const styles = {
  app: {
    fontFamily: "'Inter', sans-serif",
    background: colors.bg,
    color: colors.sand,
    minHeight: "100vh",
    maxWidth: 420,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 20px 14px",
    borderBottom: `1px solid ${colors.border}`,
  },
  brand: { display: "flex", alignItems: "center", gap: 8 },
  brandText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: "-0.01em",
  },
  topbarRight: { display: "flex", alignItems: "center", gap: 10 },
  identityBadge: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: colors.bgElevated,
    border: `1px solid ${colors.border}`,
    color: colors.sand,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Inter', sans-serif",
  },
  multiAlertTabs: { display: "flex", gap: 6, marginBottom: 2, flexWrap: "wrap" },
  multiAlertTab: {
    background: colors.bgElevated,
    border: `1px solid ${colors.border}`,
    color: colors.muted,
    fontSize: 12,
    fontWeight: 600,
    padding: "6px 12px",
    borderRadius: 999,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  multiAlertTabActive: {
    background: colors.alertDim,
    borderColor: "rgba(232,56,79,0.4)",
    color: colors.alert,
  },
  identityWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "64px 28px 40px",
    gap: 4,
  },
  identityTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 20,
    marginTop: 12,
  },
  identitySub: { color: colors.muted, fontSize: 13, marginBottom: 28 },
  identityList: { width: "100%", display: "flex", flexDirection: "column", gap: 8 },
  identityOption: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    background: colors.bgElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: "13px 14px",
    color: colors.sand,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  identityCustomRow: { display: "flex", gap: 8, width: "100%", marginTop: 20 },
  identityCustomBtn: {
    background: colors.safe,
    color: "#0E1913",
    border: "none",
    borderRadius: 9,
    padding: "0 18px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  identityHint: {
    color: colors.mutedDeep,
    fontSize: 11.5,
    textAlign: "center",
    marginTop: 28,
    lineHeight: 1.5,
  },
  tabSwitch: {
    display: "flex",
    background: colors.bgElevated,
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  tabBtn: {
    position: "relative",
    background: "transparent",
    border: "none",
    color: colors.muted,
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    padding: "7px 14px",
    borderRadius: 8,
    cursor: "pointer",
  },
  tabBtnActive: {
    background: "#252B3D",
    color: colors.sand,
  },
  dotAlert: {
    position: "absolute",
    top: 5,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: colors.alert,
  },
  userWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "36px 24px 28px",
  },
  statusPill: (status) => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: status === "safe" ? colors.safe : colors.alert,
    background: status === "safe" ? "rgba(63,167,150,0.12)" : colors.alertDim,
    padding: "6px 14px",
    borderRadius: 999,
    marginBottom: 44,
  }),
  sosZone: { position: "relative" },
  sosButton: {
    position: "relative",
    width: 220,
    height: 220,
    borderRadius: "50%",
    background: "radial-gradient(circle at 35% 30%, #2A1418, #1C1013)",
    border: `2px solid ${colors.alert}`,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
    touchAction: "none",
    transition: "transform 150ms ease",
  },
  sosButtonArming: {
    transform: "scale(0.96)",
  },
  sosInner: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    color: colors.alert,
    pointerEvents: "none",
  },
  sosLabel: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: 22,
    letterSpacing: "0.06em",
  },
  hint: {
    color: colors.muted,
    fontSize: 12.5,
    marginTop: 24,
    textAlign: "center",
    lineHeight: 1.5,
  },
  contactsPreview: {
    marginTop: "auto",
    paddingTop: 40,
    width: "100%",
  },
  contactsPreviewHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: colors.muted,
    marginBottom: 10,
  },
  manageLink: {
    marginLeft: "auto",
    background: "transparent",
    border: "none",
    color: colors.safe,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
    fontFamily: "'Inter', sans-serif",
  },
  waBtn: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "rgba(63,167,150,0.15)",
    color: colors.safe,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    flexShrink: 0,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "flex-end",
    zIndex: 50,
  },
  modalSheet: {
    width: "100%",
    maxWidth: 420,
    margin: "0 auto",
    background: colors.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: "18px 18px 24px",
    maxHeight: "85vh",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 600,
    fontSize: 16,
  },
  modalClose: {
    background: "#252B3D",
    border: "none",
    color: colors.sand,
    width: 30,
    height: 30,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  modalList: { display: "flex", flexDirection: "column", gap: 8 },
  modalEmpty: { fontSize: 12.5, color: colors.muted, padding: "8px 0" },
  modalRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#151a27",
    borderRadius: 10,
    padding: "9px 10px",
  },
  modalPhoneInput: {
    marginTop: 4,
    width: "100%",
    background: "transparent",
    border: `1px solid ${colors.border}`,
    borderRadius: 7,
    color: colors.sand,
    fontSize: 12,
    padding: "6px 8px",
    fontFamily: "'Inter', sans-serif",
    boxSizing: "border-box",
  },
  modalRemoveBtn: {
    background: "transparent",
    border: "none",
    color: colors.mutedDeep,
    cursor: "pointer",
    padding: 4,
    flexShrink: 0,
  },
  modalAddSection: {
    borderTop: `1px solid ${colors.border}`,
    paddingTop: 14,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  modalAddTitle: { fontSize: 12.5, fontWeight: 600, color: colors.muted },
  modalInput: {
    width: "100%",
    background: "#151a27",
    border: `1px solid ${colors.border}`,
    borderRadius: 9,
    color: colors.sand,
    fontSize: 13.5,
    padding: "10px 12px",
    fontFamily: "'Inter', sans-serif",
    boxSizing: "border-box",
  },
  modalError: { fontSize: 11.5, color: colors.alert },
  modalAddBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    background: colors.safe,
    color: "#0E1913",
    border: "none",
    borderRadius: 10,
    padding: "11px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    marginTop: 4,
  },
  avatarRow: { display: "flex", gap: 8 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: colors.bgElevated,
    border: `1px solid ${colors.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 600,
    color: colors.sand,
  },
  avatarAdd: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: `1px dashed ${colors.mutedDeep}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: colors.mutedDeep,
  },
  activePanel: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  activeHeader: { display: "flex", alignItems: "center", gap: 12 },
  pulseDot: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: colors.alert,
    boxShadow: `0 0 0 0 ${colors.alert}`,
    animation: "none",
    flexShrink: 0,
  },
  activeTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 600,
    fontSize: 15,
  },
  activeSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  mapPlaceholder: {
    background: colors.bgElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: 14,
    padding: "28px 20px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  coords: { fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, marginTop: 4 },
  coordsSub: { fontSize: 11.5, color: colors.muted },
  notifiedList: { display: "flex", flexDirection: "column", gap: 8 },
  notifiedRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: colors.bgElevated,
    borderRadius: 10,
    padding: "9px 12px",
  },
  avatarSm: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "#252B3D",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 600,
    flexShrink: 0,
  },
  notifiedName: { fontSize: 13, fontWeight: 600 },
  notifiedStatus: { fontSize: 11, color: colors.muted },
  resolveBtn: {
    marginTop: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: colors.safe,
    color: "#0E1913",
    border: "none",
    borderRadius: 12,
    padding: "13px",
    fontSize: 13.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  familyWrap: { flex: 1, padding: "24px 20px 28px", display: "flex", flexDirection: "column", gap: 16 },
  familyAlertBanner: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: colors.alertDim,
    border: `1px solid rgba(232,56,79,0.35)`,
    borderRadius: 12,
    padding: "12px 14px",
  },
  canvasWrap: { position: "relative", borderRadius: 14, overflow: "hidden", border: `1px solid ${colors.border}` },
  canvas: { display: "block", width: "100%", height: "auto" },
  canvasBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    fontSize: 9.5,
    color: colors.muted,
    background: "rgba(18,21,31,0.8)",
    padding: "3px 7px",
    borderRadius: 6,
  },
  actionRow: { display: "flex", gap: 10 },
  callBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    background: colors.alert,
    color: "#fff",
    textDecoration: "none",
    borderRadius: 11,
    padding: "12px",
    fontSize: 13,
    fontWeight: 700,
  },
  mapsBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    background: colors.bgElevated,
    border: `1px solid ${colors.border}`,
    color: colors.sand,
    textDecoration: "none",
    borderRadius: 11,
    padding: "12px",
    fontSize: 13,
    fontWeight: 600,
  },
  trailInfo: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: colors.muted, justifyContent: "center" },
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    paddingTop: 40,
    gap: 6,
  },
  emptyTitle: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 15, marginTop: 12 },
  emptySub: { fontSize: 12.5, color: colors.muted, maxWidth: 260, lineHeight: 1.5 },
  watchList: { width: "100%", display: "flex", flexDirection: "column", gap: 8, marginTop: 32 },
  watchRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: colors.bgElevated,
    borderRadius: 10,
    padding: "9px 12px",
  },
  safeTag: {
    fontSize: 10.5,
    fontWeight: 700,
    color: colors.safe,
    background: "rgba(63,167,150,0.12)",
    padding: "3px 8px",
    borderRadius: 999,
  },
};
