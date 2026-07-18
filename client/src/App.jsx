import { useEffect, useMemo, useState } from 'react';

const API = 'https://rar-9k26.onrender.com/api';

const emptyForm = {
  name: '',
  username: '',
  password: '',
  travelMinutes: 15,
  role: 'patient',
  destination: 'doctor',
  hospitalId: '',
  doctorId: '',
  labId: '',
  prescribedLab: false,
  tokenDate: new Date().toISOString().split('T')[0],
  capacity: 2,
  dailyTokenLimit: 50,
  consultationFee: 0,
  avgConsultationMinutes: 12,
  avgDailyBreakMinutes: 120,
  branch: ''
};

const roleHome = {
  admin: 'admin',
  hospital: 'hospital',
  patient: 'patient',
  doctor: 'doctor',
  lab: 'lab'
};

function getRoute() {
  return window.location.hash.replace('#/', '') || 'login';
}

function go(route) {
  window.location.hash = `/${route}`;
}

function humanTime(minutes = 0) {
  if (minutes <= 0) return '0m';
  const safeMinutes = Math.round(minutes);
  const hrs = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hrs ? `${hrs}h ` : ''}${mins}m`;
}

function getLeaveStatus(waitMinutes, travelMinutes) {
  const minutesUntilLeave = waitMinutes - travelMinutes;
  const leaveInMinutes = Math.max(0, minutesUntilLeave);
  const leaveAt = new Date(Date.now() + leaveInMinutes * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (minutesUntilLeave < 0) {
    return {
      label: 'You will be late either way',
      color: 'red',
      headline: 'Leave immediately',
      timeText: `${humanTime(Math.abs(minutesUntilLeave))} late`,
      note: `Travel is ${humanTime(Math.abs(minutesUntilLeave))} longer than the estimated wait.`,
      leaveAt,
      leaveInMinutes
    };
  }

  if (minutesUntilLeave <= 5) {
    return {
      label: 'You should leave now',
      color: 'yellow',
      headline: 'Leave now',
      timeText: `${humanTime(minutesUntilLeave)} buffer`,
      note: 'This is the correct time to start from home.',
      leaveAt,
      leaveInMinutes
    };
  }

  if (minutesUntilLeave <= 15) {
    return {
      label: 'You could be late',
      color: 'orange',
      headline: `Leave by ${leaveAt}`,
      timeText: `${humanTime(minutesUntilLeave)} left`,
      note: 'Your buffer is small, so delays can make you late.',
      leaveAt,
      leaveInMinutes
    };
  }

  return {
    label: 'You have time',
    color: 'green',
    headline: `Leave by ${leaveAt}`,
    timeText: `${humanTime(minutesUntilLeave)} left`,
    note: 'You can wait before leaving home.',
    leaveAt,
    leaveInMinutes
  };
}

function titleRole(role) {
  return role ? role[0].toUpperCase() + role.slice(1) : '';
}

function App() {
  const [route, setRoute] = useState(getRoute);
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = window.localStorage.getItem('currentUser');
    return saved ? JSON.parse(saved) : null;
  });
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState({ doctors: [], labs: [], stats: null });
  const [hospitals, setHospitals] = useState([]);
  const [adminData, setAdminData] = useState(null);
  const [message, setMessage] = useState('');
  const [eta, setEta] = useState(null);
  const [patientTokens, setPatientTokens] = useState([]);
  const [editingTarget, setEditingTarget] = useState(null);

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('currentUser', JSON.stringify(currentUser));
    if (currentUser?.role === 'admin') {
      fetchAdminData();
    }
    if (currentUser?.role === 'patient') {
      fetchPatientTokens(currentUser.id);
    } else {
      setPatientTokens([]);
    }
  }, [currentUser]);

  useEffect(() => {
    if (hospitals.length && !form.hospitalId) {
      setForm((prev) => ({ ...prev, hospitalId: hospitals[0].id }));
    }
  }, [hospitals, form.hospitalId]);

  async function api(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function fetchPatientTokens(userId) {
    try {
      const data = await api(`/tokens?userId=${userId}`);
      setPatientTokens(data.tokens);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function refresh() {
    try {
      const [hospitalData, statusData] = await Promise.all([
        api('/hospitals'),
        api('/status')
      ]);
      setHospitals(hospitalData);
      setStatus(statusData);
      if (currentUser?.role === 'patient') {
        await fetchPatientTokens(currentUser.id);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function fetchAdminData() {
    try {
      setAdminData(await api('/admin/database'));
    } catch (error) {
      setMessage(error.message);
    }
  }

  const selectedHospital = useMemo(
    () => hospitals.find((hospital) => String(hospital.id) === String(form.hospitalId)),
    [hospitals, form.hospitalId]
  );

  const doctorUser = useMemo(
    () => status.doctors.find((doctor) => doctor.id === currentUser?.doctor_id),
    [status.doctors, currentUser]
  );

  const labUser = useMemo(
    () => status.labs.find((lab) => lab.id === currentUser?.lab_id),
    [status.labs, currentUser]
  );

  const hospitalDoctors = useMemo(
    () => status.doctors.filter((doctor) => doctor.hospital_id === currentUser?.hospital_id),
    [status.doctors, currentUser]
  );
  
  const selectedDoctor = useMemo(
    () => status.doctors.find((doctor) => String(doctor.id) === String(form.doctorId)),
    [status.doctors, form.doctorId]
  );

  const hospitalLabs = useMemo(
    () => status.labs.filter((lab) => lab.hospital_id === currentUser?.hospital_id),
    [status.labs, currentUser]
  );

  async function submitLogin(event) {
    event.preventDefault();
    try {
      const data = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ username: form.username, password: form.password })
      });
      setCurrentUser(data.user);
      setMessage(`Logged in as ${data.user.name}.`);
      setForm((prev) => ({ ...prev, username: '', password: '' }));
      go(roleHome[data.user.role] || 'queues');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function submitRegister(event) {
    event.preventDefault();
    const endpoint = form.role === 'hospital' ? '/register/hospital' : '/register/patient';
    try {
      await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          username: form.username,
          password: form.password,
          travelMinutes: form.travelMinutes,
          branch: form.branch
        })
      });
      setMessage(`${titleRole(form.role)} registered. Please log in.`);
      setForm({ ...emptyForm, role: form.role });
      refresh();
      go('login');
    } catch (error) {
      setMessage(error.message);
    }
  }

  function logout() {
    setCurrentUser(null);
    setAdminData(null);
    setEta(null);
    setMessage('Logged out.');
    go('login');
  }

  async function submitToken(event) {
    event.preventDefault();
    try {
      const data = await api('/tokens', {
        method: 'POST',
        body: JSON.stringify({
          userId: currentUser.id,
          destination: form.destination,
          doctorId: form.doctorId,
          labId: form.labId,
          prescribedLab: form.prescribedLab,
          tokenDate: form.tokenDate
        })
      });
      const travel = Number(form.travelMinutes) || Number(currentUser.travel_minutes) || 0;
      const leaveIn = Math.max(0, data.estimatedWaitMinutes - travel);
      const leaveAt = new Date(Date.now() + leaveIn * 60000).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
      setEta({ token: data.token.token_number, wait: data.estimatedWaitMinutes, leaveAt });
      setMessage(`Token ${data.token.token_number} booked. Estimated wait ${humanTime(data.estimatedWaitMinutes)}.`);
      await fetchPatientTokens(currentUser.id);
      refresh();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function createDoctor(event) {
    event.preventDefault();
    try {
      if (editingTarget?.type === 'doctor') {
        await api(`/hospitals/${currentUser.hospital_id}/doctors/${editingTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name,
            dailyTokenLimit: form.dailyTokenLimit,
            consultationFee: form.consultationFee,
            avgConsultationMinutes: form.avgConsultationMinutes,
            avgDailyBreakMinutes: form.avgDailyBreakMinutes
          })
        });
        setMessage(`Doctor updated: ${form.name}.`);
      } else {
        await api(`/hospitals/${currentUser.hospital_id}/doctors`, {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            username: form.username,
            password: form.password,
            dailyTokenLimit: form.dailyTokenLimit,
            consultationFee: form.consultationFee,
            avgConsultationMinutes: form.avgConsultationMinutes,
            avgDailyBreakMinutes: form.avgDailyBreakMinutes
          })
        });
        setMessage(`Doctor login created for ${form.name}.`);
      }
      setEditingTarget(null);
      setForm((prev) => ({ ...prev, name: '', username: '', password: '', dailyTokenLimit: 50, consultationFee: 0, avgConsultationMinutes: 12, avgDailyBreakMinutes: 120 }));
      refresh();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function createLab(event) {
    event.preventDefault();
    try {
      if (editingTarget?.type === 'lab') {
        await api(`/hospitals/${currentUser.hospital_id}/labs/${editingTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name,
            capacity: form.capacity,
            dailyTokenLimit: form.dailyTokenLimit
          })
        });
        setMessage(`Lab updated: ${form.name}.`);
      } else {
        await api(`/hospitals/${currentUser.hospital_id}/labs`, {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            username: form.username,
            password: form.password,
            capacity: form.capacity,
            dailyTokenLimit: form.dailyTokenLimit
          })
        });
        setMessage(`Lab login created for ${form.name}.`);
      }
      setEditingTarget(null);
      setForm((prev) => ({ ...prev, name: '', username: '', password: '', capacity: 2, dailyTokenLimit: 100 }));
      refresh();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteDoctor(doctorId) {
    try {
      await api(`/hospitals/${currentUser.hospital_id}/doctors/${doctorId}`, { method: 'DELETE' });
      setMessage('Doctor deleted.');
      refresh();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteLab(labId) {
    try {
      await api(`/hospitals/${currentUser.hospital_id}/labs/${labId}`, { method: 'DELETE' });
      setMessage('Lab deleted.');
      refresh();
    } catch (error) {
      setMessage(error.message);
    }
  }

  function editDoctor(doctor) {
    setEditingTarget({ type: 'doctor', id: doctor.id });
    setForm((prev) => ({
      ...prev,
      name: doctor.name,
      username: '',
      password: '',
      dailyTokenLimit: doctor.daily_token_limit,
      consultationFee: doctor.consultation_fee ?? 0,
      avgConsultationMinutes: doctor.avg_consultation_minutes ?? 12,
      avgDailyBreakMinutes: doctor.avg_daily_break_minutes ?? 120
    }));
  }

  function editLab(lab) {
    setEditingTarget({ type: 'lab', id: lab.id });
    setForm((prev) => ({
      ...prev,
      name: lab.name,
      username: '',
      password: '',
      capacity: lab.capacity,
      dailyTokenLimit: lab.daily_token_limit
    }));
  }

  function cancelEdit() {
    setEditingTarget(null);
    setForm((prev) => ({ ...prev, name: '', username: '', password: '', capacity: 2, dailyTokenLimit: 50 }));
  }

  async function deleteToken(tokenId) {
    try {
      await api(`/tokens/${tokenId}`, {
        method: 'DELETE',
        body: JSON.stringify({ userId: currentUser.id })
      });
      setMessage('Token cancelled.');
      await fetchPatientTokens(currentUser.id);
      refresh();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function doctorAction(action, body) {
    try {
      const data = await api(`/doctors/${doctorUser.id}/${action}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined
      });
      setMessage(data.message || 'Doctor panel updated.');
      refresh();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function labAction(action, body) {
    try {
      const data = await api(`/labs/${labUser.id}/${action}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined
      });
      setMessage(data.message || 'Lab panel updated.');
      refresh();
    } catch (error) {
      setMessage(error.message);
    }
  }

  const pageProps = {
    adminData,
    currentUser,
    doctorAction,
    doctorUser,
    eta,
    fetchAdminData,
    form,
    hospitalDoctors,
    hospitalLabs,
    hospitals,
    labAction,
    labUser,
    patientTokens,
    refresh,
    selectedHospital,
    setForm,
    status,
    submitLogin,
    submitRegister,
    submitToken,
    createDoctor,
    createLab,
    deleteDoctor,
    deleteLab,
    editDoctor,
    editLab,
    cancelEdit,
    editingTarget,
    deleteToken
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>QueuePilot</h1>
        </div>
        <nav className="page-nav">
          {currentUser ? (
            <>
              <a className={route === 'queues' ? 'active' : ''} href="#/queues">Status</a>
              <a className={route === roleHome[currentUser.role] ? 'active' : ''} href={`#/${roleHome[currentUser.role]}`}>{titleRole(currentUser.role)}</a>
              {currentUser?.role === 'patient' && <a className={route === 'new-token' ? 'active' : ''} href="#/new-token">New Token</a>}
              <button type="button" onClick={logout}>Logout</button>
            </>
          ) : (
            <>
              <a className={route === 'login' ? 'active' : ''} href="#/login">Login</a>
              <a className={route === 'register' ? 'active' : ''} href="#/register">Register</a>
            </>
          )}
        </nav>
      </header>

      {currentUser && (
        <section className="identity-bar">
          <span>Signed in as</span>
          <strong>{currentUser.name}</strong>
          <span>{titleRole(currentUser.role)}</span>
        </section>
      )}

      <Page route={route} {...pageProps} />

      {message && <div className="toast">{message}</div>}
    </main>
  );
}

function Page(props) {
  const publicRoutes = ['login', 'register', 'queues'];

  if (!props.currentUser && !publicRoutes.includes(props.route)) {
    return <LoginPage {...props} />;
  }

  if (props.route === 'register') return <RegisterPage {...props} />;
  if (props.route === 'queues') return <QueuesPage {...props} />;
  if (props.route === 'new-token') return props.currentUser?.role === 'patient' ? <NewTokenPage {...props} /> : <WrongRolePage />;
  if (props.route === 'patient') return props.currentUser?.role === 'patient' ? <PatientPage {...props} /> : <WrongRolePage />;
  if (props.route === 'hospital') return props.currentUser?.role === 'hospital' ? <HospitalPage {...props} /> : <WrongRolePage />;
  if (props.route === 'doctor') return props.currentUser?.role === 'doctor' ? <DoctorPage {...props} /> : <WrongRolePage />;
  if (props.route === 'lab') return props.currentUser?.role === 'lab' ? <LabPage {...props} /> : <WrongRolePage />;
  if (props.route === 'admin') return props.currentUser?.role === 'admin' ? <AdminPage {...props} /> : <WrongRolePage />;

  return <LoginPage {...props} />;
}

function LoginPage({ form, setForm, submitLogin }) {
  return (
    <section className="auth-page">
      <div className="panel auth-card">
        <h2>Login</h2>
        <form onSubmit={submitLogin}>
          <label>Username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
          <label>Password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          <button type="submit">Login</button>
        </form>
        <p className="hint">Default admin: admin / admin123 unless changed in .env.</p>
        <a className="text-link" href="#/register">Create patient or hospital account</a>
      </div>
    </section>
  );
}

function RegisterPage({ form, setForm, submitRegister }) {
  return (
    <section className="auth-page">
      <div className="panel auth-card">
        <h2>Register</h2>
        <form onSubmit={submitRegister}>
          <div className="segmented">
            <button type="button" className={form.role === 'patient' ? 'active' : ''} onClick={() => setForm({ ...form, role: 'patient' })}>Patient</button>
            <button type="button" className={form.role === 'hospital' ? 'active' : ''} onClick={() => setForm({ ...form, role: 'hospital' })}>Hospital</button>
          </div>
          <label>{form.role === 'hospital' ? 'Hospital name' : 'Patient name'}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
          <label>Password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          {form.role === 'patient' && (
            <label>Travel minutes<input type="number" min="0" value={form.travelMinutes} onChange={(event) => setForm({ ...form, travelMinutes: event.target.value })} /></label>
          )}
          {form.role === 'hospital' && (
            <label>Hospital branch<input value={form.branch} onChange={(event) => setForm({ ...form, branch: event.target.value })} /></label>
          )}
          <button type="submit">Register {titleRole(form.role)}</button>
        </form>
        <a className="text-link" href="#/login">Back to login</a>
      </div>
    </section>
  );
}

function PatientPage({ currentUser, deleteToken, patientTokens, status }) {
  const activeTokens = patientTokens.filter((token) => ['waiting_doctor', 'in_doctor', 'waiting_lab', 'in_lab'].includes(token.status));
  const finishedTokens = patientTokens.filter((token) => token.status === 'finished');
  const travelMinutes = Number(currentUser?.travel_minutes) || 0;
  return (
    <section className="page-grid">
      <div className="panel emphasis">
        <h2>Active Appointments</h2>
        {activeTokens.length ? (
          <ol className="patient-token-list">
            {activeTokens.map((token) => {
              const doctor = token.doctor_id ? status.doctors.find((item) => item.id === token.doctor_id) : null;
              const waitMinutes = doctor?.avg_wait_with_break_minutes ?? doctor?.avg_wait_minutes ?? 0;
              const leaveStatus = doctor && token.status === 'waiting_doctor'
                ? getLeaveStatus(waitMinutes, travelMinutes)
                : null;

              return (
                <li key={token.id} className="active-token-card">
                  <div>
                    <strong>#{token.token_number}</strong>
                    <span>{token.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div>
                    <small>{token.lab_id ? 'Lab' : 'Doctor'}</small>
                    <small>Date {new Date(token.token_date).toLocaleDateString()}</small>
                  </div>
                  {doctor && (
                    <div>
                      <span>{doctor.name}</span>
                      <span>Wait {humanTime(waitMinutes)}</span>
                    </div>
                  )}
                  {leaveStatus && <TimeStatus status={leaveStatus} />}
                  {token.status === 'in_doctor' && (
                    <div className="time-status green">
                      <div className="time-status-main">
                        <span className="time-mark" aria-hidden="true" />
                        <div>
                          <strong>Consultation started</strong>
                          <span>You are already with the doctor.</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div>
                    <span>Priority {token.priority}</span>
                    <button type="button" className="small-button" onClick={() => deleteToken(token.id)}>Cancel</button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p>No active appointments. Book a new token.</p>
        )}
      </div>
      <div className="panel emphasis">
        <h2>History</h2>
        {finishedTokens.length ? (
          <ol className="patient-token-list finished-list">
            {finishedTokens.map((token) => (
              <li key={token.id}>
                <strong>#{token.token_number}</strong>
                <span>{token.lab_id ? 'Lab' : 'Doctor'}</span>
                <span>Date {new Date(token.token_date).toLocaleDateString()}</span>
                <span>Priority {token.priority}</span>
                <small>Finished {new Date(token.finished_at).toLocaleString()}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p>No past appointments yet.</p>
        )}
      </div>
    </section>
  );
}

function NewTokenPage({ form, setForm, submitToken, hospitals, selectedHospital, selectedDoctor }) {
  const selectedLab = selectedHospital?.labs?.find((lab) => String(lab.id) === String(form.labId));
  const waitMinutes = selectedDoctor?.avg_wait_with_break_minutes ?? selectedDoctor?.avg_wait_minutes ?? 0;
  const travelMinutes = Number(form.travelMinutes) || 0;
  const leaveStatus = selectedDoctor ? getLeaveStatus(waitMinutes, travelMinutes) : null;
  return (
    <section className="page-grid">
      <div className="panel emphasis">
        <div className="section-title">
          <h2>Book New Appointment</h2>
          <span className="panel-note">Same-day and 30-day appointments with priority lab referrals.</span>
        </div>
        <form onSubmit={submitToken}>
          <label>
            Queue type
            <select value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value, doctorId: '', labId: '' })}>
              <option value="doctor">Doctor</option>
              <option value="lab">Lab</option>
            </select>
          </label>
          <label>
            Hospital
            <select value={form.hospitalId} onChange={(event) => setForm({ ...form, hospitalId: event.target.value, doctorId: '', labId: '' })}>
              {hospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name}</option>)}
            </select>
          </label>
          <label>
            Travel minutes
            <input
              type="number"
              min="0"
              value={form.travelMinutes}
              onChange={(event) => setForm({ ...form, travelMinutes: event.target.value })}
            />
          </label>
          <label>
            Appointment date
            <input
              type="date"
              value={form.tokenDate}
              min={new Date().toISOString().split('T')[0]}
              max={new Date(new Date().setDate(new Date().getDate() + 30)).toISOString().split('T')[0]}
              onChange={(event) => setForm({ ...form, tokenDate: event.target.value })}
            />
          </label>
          {form.destination === 'doctor' ? (
            <>
              <label>
                Doctor
                <select value={form.doctorId} onChange={(event) => setForm({ ...form, doctorId: event.target.value })}>
                  <option value="">Select doctor</option>
                  {selectedHospital?.doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>{doctor.name} ({doctor.dailyTokenLimit}/day)</option>
                  ))}
                </select>
              </label>
              {selectedDoctor && (
                <div className="doctor-summary neon-box">
                  <div><strong>Average consultation</strong> {selectedDoctor.avg_service_minutes} min</div>
                  <div><strong>Average physician break</strong> {selectedDoctor.avg_break_minutes} min</div>
                  <div><strong>Queue length</strong> {selectedDoctor.queue_length}</div>
                  <div><strong>Estimated wait</strong> {selectedDoctor.avg_wait_minutes} min</div>
                  <div><strong>Wait with breaks</strong> {selectedDoctor.avg_wait_with_break_minutes} min</div>
                  <div><strong>Leave in</strong> {humanTime(leaveStatus.leaveInMinutes)}</div>
                  <div><strong>Leave at</strong> {leaveStatus.leaveAt}</div>
                  <div><strong>Travel time</strong> {travelMinutes} min</div>
                  {leaveStatus && <TimeStatus status={leaveStatus} />}
                  <div><strong>Fee</strong> ₹{selectedDoctor.consultation_fee ?? 0}</div>
                </div>
              )}
            </>
          ) : (
            <>
              <label>
                Lab
                <select value={form.labId} onChange={(event) => setForm({ ...form, labId: event.target.value })}>
                  <option value="">Select lab</option>
                  {selectedHospital?.labs.map((lab) => (
                    <option key={lab.id} value={lab.id}>{lab.name} (cap {lab.capacity})</option>
                  ))}
                </select>
              </label>
              <label className="checkline">
                <input type="checkbox" checked={form.prescribedLab} onChange={(event) => setForm({ ...form, prescribedLab: event.target.checked })} />
                Prescribed by doctor
              </label>
            </>
          )}
          <button type="submit">Book Appointment</button>
        </form>
      </div>
      <div className="panel neon-box">
        <h2>Appointment summary</h2>
        <p className="panel-note">Selected hospital: {selectedHospital?.name || 'Choose a hospital'}{selectedHospital?.branch ? ` — ${selectedHospital.branch}` : ''}</p>
        <div className="doctor-summary">
          <div><strong>Queue</strong> {form.destination === 'doctor' ? 'Doctor' : 'Lab'}</div>
          <div><strong>Date</strong> {form.tokenDate}</div>
          <div><strong>Travel</strong> {form.travelMinutes} min</div>
          <div><strong>Destination</strong> {form.destination === 'doctor' ? selectedDoctor?.name || 'Not selected' : selectedLab?.name || 'Not selected'}</div>
          {selectedDoctor && <div><strong>Consultation fee</strong> ₹{selectedDoctor.consultation_fee ?? 0}</div>}
          {selectedDoctor && leaveStatus && <TimeStatus status={leaveStatus} />}
        </div>
      </div>
    </section>
  );
}

function TimeStatus({ status }) {
  return (
    <div className={`time-status ${status.color}`}>
      <div className="time-status-main">
        <span className="time-mark" aria-hidden="true" />
        <div>
          <strong>{status.label}</strong>
          <span>{status.headline}</span>
        </div>
      </div>
      <b>{status.timeText}</b>
      <span>{status.note}</span>
    </div>
  );
}

function HospitalPage({ createDoctor, createLab, form, hospitalDoctors, hospitalLabs, setForm, deleteDoctor, deleteLab, editDoctor, editLab, cancelEdit, editingTarget }) {
  return (
    <>
      <section className="page-grid">
        <div className="panel">
          <h2>{editingTarget?.type === 'doctor' ? 'Edit Doctor' : 'Create Doctor Login'}</h2>
          <form onSubmit={createDoctor}>
            <label>Doctor name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Doctor username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
            <label>Doctor password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            <label>Daily token limit<input type="number" min="1" value={form.dailyTokenLimit} onChange={(event) => setForm({ ...form, dailyTokenLimit: event.target.value })} /></label>
            <label>Consultation fee<input type="number" min="0" value={form.consultationFee} onChange={(event) => setForm({ ...form, consultationFee: event.target.value })} /></label>
            <label>Avg consultation time<input type="number" min="1" value={form.avgConsultationMinutes} onChange={(event) => setForm({ ...form, avgConsultationMinutes: event.target.value })} /> minutes</label>
            <label>Avg daily break<input type="number" min="0" value={form.avgDailyBreakMinutes} onChange={(event) => setForm({ ...form, avgDailyBreakMinutes: event.target.value })} /> minutes</label>
            <div className="button-row">
              <button type="submit">{editingTarget?.type === 'doctor' ? 'Update Doctor' : 'Create Doctor Login'}</button>
              {editingTarget?.type === 'doctor' && <button type="button" onClick={cancelEdit}>Cancel</button>}
            </div>
          </form>
        </div>
        <div className="panel">
          <h2>{editingTarget?.type === 'lab' ? 'Edit Lab' : 'Create Lab Login'}</h2>
          <form onSubmit={createLab}>
            <label>Lab name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Lab username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
            <label>Lab password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            <label>Patients at a time<input type="number" min="1" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /></label>
            <label>Daily token limit<input type="number" min="1" value={form.dailyTokenLimit} onChange={(event) => setForm({ ...form, dailyTokenLimit: event.target.value })} /></label>
            <div className="button-row">
              <button type="submit">{editingTarget?.type === 'lab' ? 'Update Lab' : 'Create Lab Login'}</button>
              {editingTarget?.type === 'lab' && <button type="button" onClick={cancelEdit}>Cancel</button>}
            </div>
          </form>
        </div>
      </section>
      <section className="panel">
        <h2>Hospital Queues</h2>
        <div className="cards-grid">
          {[...hospitalDoctors, ...hospitalLabs].map((unit) => (
            <QueueCard key={`${unit.capacity ? 'lab' : 'doctor'}-${unit.id}`} unit={unit} />
          ))}
        </div>
      </section>
      <section className="page-grid">
        <div className="panel">
          <h2>Doctors</h2>
          {hospitalDoctors.length ? (
            <table className="admin-table">
              <thead>
                <tr><th>Name</th><th>Limit</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {hospitalDoctors.map((doctor) => (
                  <tr key={doctor.id}>
                    <td>{doctor.name}</td>
                    <td>{doctor.daily_token_limit}</td>
                    <td>
                      <button type="button" onClick={() => editDoctor(doctor)}>Edit</button>
                      <button type="button" onClick={() => deleteDoctor(doctor.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No doctors found.</p>
          )}
        </div>
        <div className="panel">
          <h2>Labs</h2>
          {hospitalLabs.length ? (
            <table className="admin-table">
              <thead>
                <tr><th>Name</th><th>Capacity</th><th>Limit</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {hospitalLabs.map((lab) => (
                  <tr key={lab.id}>
                    <td>{lab.name}</td>
                    <td>{lab.capacity}</td>
                    <td>{lab.daily_token_limit}</td>
                    <td>
                      <button type="button" onClick={() => editLab(lab)}>Edit</button>
                      <button type="button" onClick={() => deleteLab(lab.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No labs found.</p>
          )}
        </div>
      </section>
    </>
  );
}

function DoctorPage({ doctorAction, doctorUser, hospitalLabs }) {
  if (!doctorUser) return <MissingPanel label="doctor" />;
  return (
    <section className="panel">
      <h2>Doctor Panel</h2>
      <div className="metric-row">
        <Metric label="Waiting" value={doctorUser.queue_length} />
        <Metric label="Finished today" value={doctorUser.finished_today} />
        <Metric label="Daily limit" value={doctorUser.daily_token_limit} />
        <Metric label="Break" value={doctorUser.on_break ? 'On' : 'Off'} />
      </div>
      <div className="current-box">
        <span>Current patient</span>
        <strong>{doctorUser.current?.patient_name || 'None'}</strong>
      </div>
      <div className="action-group">
        <button type="button" onClick={() => doctorAction('next')} disabled={doctorUser.on_break || doctorUser.current}>Next Patient</button>
        <button type="button" onClick={() => doctorAction('send-lab', { labId: hospitalLabs[0]?.id })} disabled={!doctorUser.current}>Send To Lab Queue</button>
        <button type="button" onClick={() => doctorAction('finish')} disabled={!doctorUser.current}>Finish Patient</button>
        <button type="button" onClick={() => doctorAction('break')}>{doctorUser.on_break ? 'End Break' : 'Take Break'}</button>
      </div>
      <QueueList title="Waiting patients" items={doctorUser.queue} />
    </section>
  );
}

function LabPage({ labAction, labUser }) {
  if (!labUser) return <MissingPanel label="lab" />;
  return (
    <section className="panel">
      <h2>Lab Panel</h2>
      <div className="metric-row">
        <Metric label="Waiting" value={labUser.queue_length} />
        <Metric label="Active" value={`${labUser.active_patients.length}/${labUser.capacity}`} />
        <Metric label="Finished today" value={labUser.finished_today} />
        <Metric label="Daily limit" value={labUser.daily_token_limit} />
      </div>
      <div className="action-group">
        <button type="button" onClick={() => labAction('start')} disabled={labUser.active_patients.length >= labUser.capacity}>Start Next Patient</button>
      </div>
      <QueueList
        title="Active patients"
        items={labUser.active_patients}
        action={(patient) => <button type="button" onClick={() => labAction('finish', { patientId: patient.id })}>Finish</button>}
      />
      <QueueList title="Waiting patients" items={labUser.queue} showPriority />
    </section>
  );
}

function AdminPage({ adminData, fetchAdminData }) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>Admin Database</h2>
        <button type="button" onClick={fetchAdminData}>Refresh</button>
      </div>
      {adminData ? (
        <div className="admin-grid">
          {Object.entries(adminData).map(([name, rows]) => (
            <DataTable key={name} name={name} rows={rows} />
          ))}
        </div>
      ) : (
        <p>Loading database tables...</p>
      )}
    </section>
  );
}

function QueuesPage({ status }) {
  return (
    <>
      <section className="dashboard">
        <Metric label="Hospitals" value={status.stats?.total_hospitals || 0} />
        <Metric label="Doctors" value={status.stats?.total_doctors || 0} />
        <Metric label="Labs" value={status.stats?.total_labs || 0} />
      </section>
      <section className="page-grid">
        <div className="panel">
          <h2>Doctors</h2>
          <div className="cards-grid">
            {status.doctors.map((doctor) => <QueueCard key={doctor.id} unit={doctor} />)}
          </div>
        </div>
        <div className="panel">
          <h2>Labs</h2>
          <div className="cards-grid">
            {status.labs.map((lab) => <QueueCard key={lab.id} unit={lab} />)}
          </div>
        </div>
      </section>
    </>
  );
}

function WrongRolePage() {
  return (
    <section className="panel centered-panel">
      <h2>Page Not Available</h2>
      <p>This login does not have access to that page.</p>
      <a className="text-link" href="#/queues">View public queues</a>
    </section>
  );
}

function MissingPanel({ label }) {
  return (
    <section className="panel centered-panel">
      <h2>Missing {titleRole(label)} Profile</h2>
      <p>This account is not connected to a {label} record.</p>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function QueueCard({ unit }) {
  const isLab = Number.isInteger(unit.capacity);
  return (
    <article className="queue-card">
      <strong>{unit.name}</strong>
      <span>{unit.hospital_name || (isLab ? 'Lab' : 'Doctor')}</span>
      <div>
        <b>{unit.queue_length || 0}</b> waiting
        {isLab && <em>{unit.active_patients?.length || 0}/{unit.capacity} active</em>}
      </div>
    </article>
  );
}

function QueueList({ title, items = [], action, showPriority = false }) {
  return (
    <div className="queue-list">
      <h3>{title}</h3>
      {items.length ? (
        <ol>
          {items.map((patient) => (
            <li key={patient.id}>
              <span>
                #{patient.token_number} {patient.patient_name}
                {showPriority && <small>{patient.prescribed_lab ? 'prescribed' : 'normal'}</small>}
              </span>
              {action?.(patient)}
            </li>
          ))}
        </ol>
      ) : (
        <p>No patients here.</p>
      )}
    </div>
  );
}

function DataTable({ name, rows }) {
  const columns = rows[0] ? Object.keys(rows[0]).slice(0, 6) : [];
  return (
    <div className="data-table">
      <h3>{name}</h3>
      {rows.length ? (
        <table>
          <thead>
            <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((row, index) => (
              <tr key={row.id || index}>
                {columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No rows.</p>
      )}
    </div>
  );
}

export default App;
