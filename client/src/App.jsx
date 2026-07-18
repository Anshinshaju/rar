import { useEffect, useMemo, useState } from 'react';

const API = 'http://localhost:4000/api';

function humanTime(minutes) {
  if (minutes <= 0) return 'now';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs ? `${hrs}h ` : ''}${mins}m`;
}

function App() {
  const [status, setStatus] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [currentUser, setCurrentUser] = useState(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const saved = window.localStorage.getItem('currentUser');
    return saved ? JSON.parse(saved) : null;
  });
  const [form, setForm] = useState({
    name: '',
    username: '',
    password: '',
    travelMinutes: 15,
    destination: 'doctor',
    hospitalId: '',
    doctorId: '',
    labId: '',
    prescribedLab: false,
    role: 'patient',
    capacity: 3
  });
  const [message, setMessage] = useState('');
  const [patientEta, setPatientEta] = useState(null);

  useEffect(() => {
    fetchStatus();
    fetchHospitals();
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (hospitals.length && !form.hospitalId) {
      setForm((prev) => ({ ...prev, hospitalId: hospitals[0].id }));
    }
  }, [hospitals]);

  useEffect(() => {
    window.localStorage.setItem('currentUser', JSON.stringify(currentUser));
  }, [currentUser]);

  async function fetchStatus() {
    try {
      const res = await fetch(`${API}/status`);
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      console.error(error);
    }
  }

  async function fetchHospitals() {
    try {
      const res = await fetch(`${API}/hospitals`);
      const data = await res.json();
      setHospitals(data);
      if (data.length && !form.hospitalId) {
        setForm((prev) => ({ ...prev, hospitalId: data[0].id }));
      }
    } catch (error) {
      console.error(error);
    }
  }

  const selectedHospital = useMemo(
    () => hospitals.find((hospital) => hospital.id === form.hospitalId),
    [hospitals, form.hospitalId]
  );

  const selectedDoctor = useMemo(
    () => status?.doctors.find((doc) => doc.id === form.doctorId) || null,
    [status, form.doctorId]
  );

  const selectedLab = useMemo(
    () => status?.labs.find((lab) => lab.id === form.labId) || null,
    [status, form.labId]
  );

  const doctorUser = currentUser?.role === 'doctor' ? status?.doctors.find((doc) => doc.id === currentUser.doctorId) : null;
  const labUser = currentUser?.role === 'lab' ? status?.labs.find((lab) => lab.id === currentUser.labId) : null;

  async function submitRegister(event) {
    event.preventDefault();
    const endpoint = form.role === 'hospital' ? 'register/hospital' : 'register/patient';
    const body = {
      name: form.name,
      username: form.username,
      password: form.password,
      travelMinutes: form.role === 'patient' ? form.travelMinutes : undefined
    };
    try {
      const res = await fetch(`${API}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Register failed');
      setMessage('Registration successful. Please log in.');
      setForm((prev) => ({ ...prev, name: '', username: '', password: '' }));
      fetchHospitals();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username, password: form.password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      setCurrentUser(data.user);
      setMessage(`Logged in as ${data.user.name} (${data.user.role}).`);
      setForm((prev) => ({ ...prev, username: '', password: '' }));
    } catch (error) {
      setMessage(error.message);
    }
  }

  function logout() {
    setCurrentUser(null);
    setMessage('Logged out.');
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (!currentUser || currentUser.role !== 'patient') {
      setMessage('Please log in as patient to book a token.');
      return;
    }
    if (!form.destination) {
      setMessage('Choose a destination.');
      return;
    }
    const payload = {
      userId: currentUser.id,
      destination: form.destination,
      doctorId: form.destination === 'doctor' ? form.doctorId : null,
      labId: form.destination === 'lab' ? form.labId : null,
      travelMinutes: Number(currentUser.travelMinutes || form.travelMinutes),
      prescribedLab: form.prescribedLab
    };
    try {
      const res = await fetch(`${API}/patients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Booking failed');
      setMessage(`Booked token. Estimated wait ${humanTime(data.estimatedWaitMinutes)}.`);
      const leaveIn = Math.max(0, data.estimatedWaitMinutes - payload.travelMinutes);
      const leaveAt = new Date(Date.now() + leaveIn * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setPatientEta({ wait: data.estimatedWaitMinutes, leaveBy: leaveAt, leaveIn });
      fetchStatus();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function submitHospitalDoctor(event) {
    event.preventDefault();
    if (!currentUser || currentUser.role !== 'hospital') {
      setMessage('Only hospitals can register doctors.');
      return;
    }
    try {
      const res = await fetch(`${API}/hospitals/${currentUser.hospitalId}/doctors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, username: form.username, password: form.password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Doctor registration failed');
      setMessage(`Doctor ${data.doctor.name} registered.`);
      setForm((prev) => ({ ...prev, name: '', username: '', password: '' }));
      fetchHospitals();
      fetchStatus();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function submitHospitalLab(event) {
    event.preventDefault();
    if (!currentUser || currentUser.role !== 'hospital') {
      setMessage('Only hospitals can register labs.');
      return;
    }
    try {
      const res = await fetch(`${API}/hospitals/${currentUser.hospitalId}/labs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, username: form.username, password: form.password, capacity: Number(form.capacity) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lab registration failed');
      setMessage(`Lab ${data.lab.name} registered.`);
      setForm((prev) => ({ ...prev, name: '', username: '', password: '', capacity: 3 }));
      fetchHospitals();
      fetchStatus();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function doctorAction(doctorId, action) {
    try {
      const res = await fetch(`${API}/doctors/${doctorId}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Action failed');
      setMessage(data.message || `Action ${action} completed.`);
      fetchStatus();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function labStart(labId) {
    try {
      const res = await fetch(`${API}/labs/${labId}/start`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Start failed');
      setMessage('Started next lab patient.');
      fetchStatus();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function labFinish(labId, patientId) {
    try {
      const res = await fetch(`${API}/labs/${labId}/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Finish failed');
      setMessage(`Finished lab patient ${data.finished.name}.`);
      fetchStatus();
    } catch (error) {
      setMessage(error.message);
    }
  }

  const analytics = status?.stats;

  return (
    <div className="app-shell">
      <header>
        <h1>Hospital Queue Monitor</h1>
        <p>Register patients, hospitals, doctors and labs. Manage queues with role-based access.</p>
        {currentUser && (
          <div className="user-banner">
            <strong>{currentUser.name}</strong> ({currentUser.role})
            <button className="small-button" onClick={logout}>Logout</button>
          </div>
        )}
      </header>

      <section className="grid-two">
        <div className="card">
          <h2>{currentUser ? 'Book patient token' : 'Patient login / register'}</h2>
          {currentUser?.role === 'patient' ? (
            <form onSubmit={submitBooking}>
              <label>
                Destination
                <select value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })}>
                  <option value="doctor">Doctor queue</option>
                  <option value="lab">Lab queue</option>
                </select>
              </label>
              <label>
                Hospital
                <select value={form.hospitalId} onChange={(e) => setForm({ ...form, hospitalId: e.target.value, doctorId: '', labId: '' })}>
                  {hospitals.map((hospital) => (
                    <option key={hospital.id} value={hospital.id}>{hospital.name}</option>
                  ))}
                </select>
              </label>
              {form.destination === 'doctor' && (
                <label>
                  Doctor
                  <select value={form.doctorId} onChange={(e) => setForm({ ...form, doctorId: e.target.value })}>
                    <option value="">Select doctor</option>
                    {selectedHospital?.doctors.map((doc) => (
                      <option key={doc.id} value={doc.id}>{doc.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {form.destination === 'lab' && (
                <label>
                  Lab
                  <select value={form.labId} onChange={(e) => setForm({ ...form, labId: e.target.value })}>
                    <option value="">Select lab</option>
                    {selectedHospital?.labs.map((lab) => (
                      <option key={lab.id} value={lab.id}>{lab.name} (cap {lab.capacity})</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Travel minutes
                <input type="number" min="0" value={form.travelMinutes} onChange={(e) => setForm({ ...form, travelMinutes: e.target.value })} />
              </label>
              <label>
                Prescribed to lab
                <input type="checkbox" checked={form.prescribedLab} onChange={(e) => setForm({ ...form, prescribedLab: e.target.checked })} />
              </label>
              <button type="submit">Book token</button>
            </form>
          ) : (
            <>
              <form onSubmit={submitLogin}>
                <label>
                  Username
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </label>
                <label>
                  Password
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </label>
                <button type="submit">Log in</button>
              </form>
              <div className="divider">or register</div>
              <form onSubmit={submitRegister}>
                <label>
                  Role
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    <option value="patient">Patient</option>
                    <option value="hospital">Hospital</option>
                  </select>
                </label>
                <label>
                  Name
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label>
                  Username
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </label>
                <label>
                  Password
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </label>
                {form.role === 'patient' && (
                  <label>
                    Travel minutes
                    <input type="number" min="0" value={form.travelMinutes} onChange={(e) => setForm({ ...form, travelMinutes: e.target.value })} />
                  </label>
                )}
                <button type="submit">Register</button>
              </form>
            </>
          )}
          {patientEta && (
            <div className="note">
              <p>Estimated wait: {humanTime(patientEta.wait)}</p>
              <p>Leave by: {patientEta.leaveBy}</p>
            </div>
          )}
          <div className="message">{message}</div>
        </div>

        <div className="card stats-card">
          <h2>Dashboard</h2>
          {analytics ? (
            <div className="stats-grid">
              <div>
                <strong>{analytics.averageConsultationMinutes} min</strong>
                <span>Avg consultation</span>
              </div>
              <div>
                <strong>{analytics.averageBreaksPerDay}</strong>
                <span>Avg breaks/day</span>
              </div>
              <div>
                <strong>{analytics.averageBreakMinutes} min</strong>
                <span>Avg break length</span>
              </div>
              <div>
                <strong>{analytics.averageBreaksPerPatient}</strong>
                <span>Avg breaks/patient</span>
              </div>
              <div>
                <strong>{analytics.doctorQueueLength}</strong>
                <span>Doctor queue total</span>
              </div>
              <div>
                <strong>{analytics.labQueueLength}</strong>
                <span>Lab queue total</span>
              </div>
            </div>
          ) : (
            <p>Loading dashboard...</p>
          )}
        </div>
      </section>

      {currentUser?.role === 'hospital' && (
        <section className="grid-two">
          <div className="card">
            <h2>Register doctor</h2>
            <form onSubmit={submitHospitalDoctor}>
              <label>
                Doctor name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Username
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </label>
              <label>
                Password
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </label>
              <button type="submit">Create doctor</button>
            </form>
          </div>
          <div className="card">
            <h2>Register lab</h2>
            <form onSubmit={submitHospitalLab}>
              <label>
                Lab name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Username
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </label>
              <label>
                Password
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </label>
              <label>
                Capacity
                <input type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </label>
              <button type="submit">Create lab</button>
            </form>
          </div>
        </section>
      )}

      {currentUser?.role === 'doctor' && doctorUser && (
        <section className="card">
          <h2>Doctor Panel</h2>
          <div className="doctor-row">
            <span>Doctor: {doctorUser.name}</span>
            <span>Queue: {doctorUser.queueLength}</span>
            <span>Wait: {humanTime(doctorUser.estimatedWaitMinutes)}</span>
          </div>
          <div className="status-box">
            <p>On break: {doctorUser.onBreak ? 'Yes' : 'No'}</p>
            <p>Current patient: {doctorUser.current?.name || 'None'}</p>
          </div>
          <div className="action-group">
            <button onClick={() => doctorAction(doctorUser.id, 'next')} disabled={doctorUser.onBreak}>Next client</button>
            <button onClick={() => doctorAction(doctorUser.id, 'finish')} disabled={!doctorUser.current}>Done</button>
            <button onClick={() => doctorAction(doctorUser.id, 'break')}>{doctorUser.onBreak ? 'End break' : 'Take break'}</button>
          </div>
          <div className="queue-list">
            <strong>Queue list</strong>
            {doctorUser.queue.length ? (
              <ol>
                {doctorUser.queue.map((patient) => (
                  <li key={patient.id}>{patient.name}</li>
                ))}
              </ol>
            ) : (
              <p>No patients waiting.</p>
            )}
          </div>
        </section>
      )}

      {currentUser?.role === 'lab' && labUser && (
        <section className="card">
          <h2>Lab Panel</h2>
          <div className="doctor-row">
            <span>Lab: {labUser.name}</span>
            <span>Capacity: {labUser.capacity}</span>
            <span>Waiting: {labUser.queueLength}</span>
          </div>
          <div className="action-group">
            <button onClick={() => labStart(labUser.id)} disabled={labUser.activePatients.length >= labUser.capacity}>Start patient</button>
          </div>
          <div className="queue-list">
            <strong>Active patients</strong>
            {labUser.activePatients.length ? (
              <ol>
                {labUser.activePatients.map((patient) => (
                  <li key={patient.id}>
                    {patient.name} <button className="small-button" onClick={() => labFinish(labUser.id, patient.id)}>Finish</button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No active patients.</p>
            )}
          </div>
          <div className="queue-list">
            <strong>Queue list</strong>
            {labUser.queue.length ? (
              <ol>
                {labUser.queue.map((patient) => (
                  <li key={patient.id}>{patient.name} ({patient.prescribedLab ? `P${patient.priority}` : `N${patient.priority}`})</li>
                ))}
              </ol>
            ) : (
              <p>No queued patients.</p>
            )}
          </div>
        </section>
      )}

      <section className="grid-two">
        <div className="card">
          <h2>Doctor list</h2>
          {status?.doctors.length ? (
            <ul>
              {status.doctors.map((doctor) => (
                <li key={doctor.id}>{doctor.name} — {doctor.queueLength} waiting</li>
              ))}
            </ul>
          ) : (
            <p>No doctors available yet.</p>
          )}
        </div>
        <div className="card">
          <h2>Lab list</h2>
          {status?.labs.length ? (
            <ul>
              {status.labs.map((lab) => (
                <li key={lab.id}>{lab.name} — {lab.queueLength} waiting, {lab.activePatients.length}/{lab.capacity} active</li>
              ))}
            </ul>
          ) : (
            <p>No labs available yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

export default App;
