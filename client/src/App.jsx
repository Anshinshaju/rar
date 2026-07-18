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
  dailyTokenLimit: 50
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
  if (minutes <= 0) return 'now';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs ? `${hrs}h ` : ''}${mins}m`;
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
          travelMinutes: form.travelMinutes
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
      await api(`/hospitals/${currentUser.hospital_id}/doctors`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          username: form.username,
          password: form.password,
          dailyTokenLimit: form.dailyTokenLimit
        })
      });
      setMessage(`Doctor login created for ${form.name}.`);
      setForm((prev) => ({ ...prev, name: '', username: '', password: '', dailyTokenLimit: 50 }));
      refresh();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function createLab(event) {
    event.preventDefault();
    try {
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
      setForm((prev) => ({ ...prev, name: '', username: '', password: '', capacity: 2, dailyTokenLimit: 100 }));
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
    createLab
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
          <button type="submit">Register {titleRole(form.role)}</button>
        </form>
        <a className="text-link" href="#/login">Back to login</a>
      </div>
    </section>
  );
}

function PatientPage({ eta, form, hospitals, selectedHospital, setForm, submitToken, patientTokens }) {
  const activeTokens = patientTokens.filter((token) => ['waiting_doctor', 'in_doctor', 'waiting_lab', 'in_lab'].includes(token.status));
  const finishedTokens = patientTokens.filter((token) => token.status === 'finished');
  return (
    <section className="page-grid">
      <div className="panel">
        <h2>Patient Token</h2>
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
            <label>
              Doctor
              <select value={form.doctorId} onChange={(event) => setForm({ ...form, doctorId: event.target.value })}>
                <option value="">Select doctor</option>
                {selectedHospital?.doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>{doctor.name} ({doctor.dailyTokenLimit}/day)</option>
                ))}
              </select>
            </label>
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
          <button type="submit">Enter Queue</button>
        </form>
      </div>
      <div className="panel emphasis">
        <h2>Current / Upcoming Appointments</h2>
        {activeTokens.length ? (
          <ol className="patient-token-list">
            {activeTokens.map((token) => (
              <li key={token.id}>
                <strong>#{token.token_number}</strong>
                <span>{token.status.replace(/_/g, ' ')}</span>
                <span>{token.lab_id ? 'Lab' : 'Doctor'}</span>
                <span>Date {new Date(token.token_date).toLocaleDateString()}</span>
                <span>Priority {token.priority}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>No current or upcoming appointments.</p>
        )}
        <h2>Finished Appointments</h2>
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
          <p>No finished appointments yet.</p>
        )}
      </div>
    </section>
  );
}

function HospitalPage({ createDoctor, createLab, form, hospitalDoctors, hospitalLabs, setForm }) {
  return (
    <>
      <section className="page-grid">
        <div className="panel">
          <h2>Create Doctor Login</h2>
          <form onSubmit={createDoctor}>
            <label>Doctor name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Doctor username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
            <label>Doctor password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            <label>Daily token limit<input type="number" min="1" value={form.dailyTokenLimit} onChange={(event) => setForm({ ...form, dailyTokenLimit: event.target.value })} /></label>
            <button type="submit">Create Doctor Login</button>
          </form>
        </div>
        <div className="panel">
          <h2>Create Lab Login</h2>
          <form onSubmit={createLab}>
            <label>Lab name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Lab username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
            <label>Lab password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            <label>Patients at a time<input type="number" min="1" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /></label>
            <label>Daily token limit<input type="number" min="1" value={form.dailyTokenLimit} onChange={(event) => setForm({ ...form, dailyTokenLimit: event.target.value })} /></label>
            <button type="submit">Create Lab Login</button>
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
