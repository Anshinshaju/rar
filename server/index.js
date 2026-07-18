const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let nextId = 1;
const users = [];
const hospitals = [];
const doctors = [];
const labs = [];
const patients = [];

const DEFAULT_CONSULTATION_MINUTES = 12;
const LAB_PRIORITY = { prescribed: 5, normal: 10 };
const PRIORITY_DECAY_INTERVAL_MS = 60 * 1000;
const PRIORITY_DECAY_MINUTES = 5;

function makeId(prefix) {
  return `${prefix}${nextId++}`;
}

function findUser(username, password) {
  return users.find((user) => user.username === username && user.password === password);
}

function getDoctorById(id) {
  return doctors.find((doctor) => doctor.id === id);
}

function getLabById(id) {
  return labs.find((lab) => lab.id === id);
}

function getHospitalById(id) {
  return hospitals.find((hospital) => hospital.id === id);
}

function computeLabPriority(patient) {
  if (!patient.prescribedLab) {
    return LAB_PRIORITY.normal;
  }
  const elapsedMinutes = Math.floor((Date.now() - patient.enteredLabAt) / 60000);
  const decayed = LAB_PRIORITY.prescribed - Math.floor(elapsedMinutes / PRIORITY_DECAY_MINUTES);
  return Math.max(1, decayed);
}

function updateLabPriorities(lab) {
  lab.queue.forEach((patient) => {
    patient.priority = computeLabPriority(patient);
  });
  lab.queue.sort((a, b) => a.priority - b.priority || a.enteredLabAt - b.enteredAt);
}

setInterval(() => {
  labs.forEach(updateLabPriorities);
}, PRIORITY_DECAY_INTERVAL_MS);

function estimateDoctorWait(doctor) {
  const average = doctor.consultationRecords.length
    ? doctor.consultationRecords.reduce((sum, value) => sum + value, 0) / doctor.consultationRecords.length
    : DEFAULT_CONSULTATION_MINUTES;
  const waitingPatients = doctor.queue.length + (doctor.current ? 1 : 0);
  return Math.round(waitingPatients * average);
}

function estimateLabWait(lab) {
  const average = 15;
  return lab.queue.length * average;
}

function createPatient(data) {
  const patient = {
    id: makeId('p'),
    userId: data.userId || null,
    name: data.name,
    travelMinutes: Number(data.travelMinutes) || 0,
    destination: data.destination,
    doctorId: data.doctorId || null,
    labId: data.labId || null,
    hospitalId: data.hospitalId || null,
    prescribedLab: Boolean(data.prescribedLab),
    status: 'waiting',
    createdAt: Date.now(),
    enteredQueueAt: Date.now(),
    priority: data.destination === 'lab' ? (data.prescribedLab ? LAB_PRIORITY.prescribed : LAB_PRIORITY.normal) : null,
    startedConsultationAt: null,
    enteredAt: Date.now()
  };
  patients.push(patient);
  return patient;
}

function computeStats() {
  const consultationRecords = doctors.flatMap((doc) => doc.consultationRecords);
  const breakRecords = doctors.flatMap((doc) => doc.breakRecords);
  const averageConsultation = consultationRecords.length
    ? consultationRecords.reduce((sum, value) => sum + value, 0) / consultationRecords.length
    : DEFAULT_CONSULTATION_MINUTES;
  const averageBreaksPerPatient = patients.length ? breakRecords.length / patients.length : 0;
  const averageBreakTime = breakRecords.length
    ? breakRecords.reduce((sum, record) => sum + record.durationMinutes, 0) / breakRecords.length
    : 0;
  const averageBreaksPerDay = doctors.reduce((sum, doc) => sum + doc.breakRecords.length, 0) / (doctors.length || 1);

  return {
    totalPatients: patients.length,
    totalDoctors: doctors.length,
    totalLabs: labs.length,
    averageConsultationMinutes: Math.round(averageConsultation * 10) / 10,
    averageBreaksPerDay: Math.round(averageBreaksPerDay * 10) / 10,
    averageBreakMinutes: Math.round(averageBreakTime * 10) / 10,
    averageBreaksPerPatient: Math.round(averageBreaksPerPatient * 10) / 10,
    doctorQueueLength: doctors.reduce((sum, doc) => sum + doc.queue.length, 0),
    labQueueLength: labs.reduce((sum, lab) => sum + lab.queue.length, 0),
    activeLabCount: labs.reduce((sum, lab) => sum + lab.activePatients.length, 0)
  };
}

app.get('/api/hospitals', (req, res) => {
  const hospitalData = hospitals.map((hospital) => ({
    id: hospital.id,
    name: hospital.name,
    doctors: doctors.filter((doc) => doc.hospitalId === hospital.id).map((doc) => ({ id: doc.id, name: doc.name })),
    labs: labs.filter((lab) => lab.hospitalId === hospital.id).map((lab) => ({ id: lab.id, name: lab.name, capacity: lab.capacity }))
  }));
  res.json(hospitalData);
});

app.post('/api/register/hospital', (req, res) => {
  const { name, username, password } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username and password are required.' });
  }
  if (users.some((user) => user.username === username)) {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  const hospital = { id: makeId('h'), name };
  hospitals.push(hospital);
  const user = { id: makeId('u'), role: 'hospital', username, password, name, hospitalId: hospital.id };
  users.push(user);
  res.json({ user, hospital });
});

app.post('/api/register/patient', (req, res) => {
  const { name, username, password, travelMinutes } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username and password are required.' });
  }
  if (users.some((user) => user.username === username)) {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  const user = { id: makeId('u'), role: 'patient', username, password, name, travelMinutes: Number(travelMinutes) || 0 };
  users.push(user);
  res.json({ user });
});

app.post('/api/hospitals/:hospitalId/doctors', (req, res) => {
  const hospital = getHospitalById(req.params.hospitalId);
  if (!hospital) {
    return res.status(404).json({ error: 'Hospital not found.' });
  }
  const { name, username, password } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username and password are required.' });
  }
  if (users.some((user) => user.username === username)) {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  const doctor = {
    id: makeId('d'),
    name,
    hospitalId: hospital.id,
    queue: [],
    current: null,
    onBreak: false,
    breakStart: null,
    breakRecords: [],
    consultationRecords: [],
    hospitalId: hospital.id
  };
  doctors.push(doctor);
  const user = { id: makeId('u'), role: 'doctor', username, password, name, doctorId: doctor.id, hospitalId: hospital.id };
  users.push(user);
  res.json({ doctor, user });
});

app.post('/api/hospitals/:hospitalId/labs', (req, res) => {
  const hospital = getHospitalById(req.params.hospitalId);
  if (!hospital) {
    return res.status(404).json({ error: 'Hospital not found.' });
  }
  const { name, username, password, capacity } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username and password are required.' });
  }
  if (users.some((user) => user.username === username)) {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  const lab = {
    id: makeId('l'),
    name,
    hospitalId: hospital.id,
    queue: [],
    activePatients: [],
    capacity: Number(capacity) || 3
  };
  labs.push(lab);
  const user = { id: makeId('u'), role: 'lab', username, password, name, labId: lab.id, hospitalId: hospital.id };
  users.push(user);
  res.json({ lab, user });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = findUser(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  res.json({ user });
});

app.post('/api/patients', (req, res) => {
  const { userId, destination, doctorId, labId, travelMinutes, prescribedLab } = req.body;
  const user = userId ? users.find((u) => u.id === userId && u.role === 'patient') : null;
  const patientName = user ? user.name : req.body.name;
  if (!patientName || !destination) {
    return res.status(400).json({ error: 'Patient name and destination are required.' });
  }

  let selectedDoctor = null;
  let selectedLab = null;
  let hospitalId = null;

  if (destination === 'doctor') {
    selectedDoctor = getDoctorById(doctorId);
    if (!selectedDoctor) {
      return res.status(400).json({ error: 'Doctor must be selected for doctor queue.' });
    }
    hospitalId = selectedDoctor.hospitalId;
  }

  if (destination === 'lab') {
    selectedLab = getLabById(labId);
    if (!selectedLab) {
      return res.status(400).json({ error: 'Lab must be selected for lab queue.' });
    }
    hospitalId = selectedLab.hospitalId;
  }

  const patient = createPatient({
    userId: user?.id || null,
    name: patientName,
    destination,
    doctorId: selectedDoctor?.id || null,
    labId: selectedLab?.id || null,
    hospitalId,
    travelMinutes,
    prescribedLab: Boolean(prescribedLab)
  });

  if (destination === 'doctor') {
    selectedDoctor.queue.push(patient);
  } else {
    selectedLab.queue.push(patient);
    updateLabPriorities(selectedLab);
  }

  const estimatedWait = destination === 'lab'
    ? estimateLabWait(selectedLab)
    : estimateDoctorWait(selectedDoctor);

  res.json({ patient, estimatedWaitMinutes: estimatedWait });
});

app.post('/api/doctors/:doctorId/next', (req, res) => {
  const doctor = getDoctorById(req.params.doctorId);
  if (!doctor) {
    return res.status(404).json({ error: 'Doctor not found.' });
  }
  if (doctor.onBreak) {
    return res.status(400).json({ error: 'Doctor is on break.' });
  }
  if (doctor.current) {
    return res.status(400).json({ error: 'Current consultation is already in progress.' });
  }
  if (!doctor.queue.length) {
    return res.status(400).json({ error: 'No patients in queue.' });
  }

  const nextPatient = doctor.queue.shift();
  nextPatient.status = 'inConsultation';
  nextPatient.startedConsultationAt = Date.now();
  doctor.current = nextPatient;

  res.json({ current: doctor.current, estimatedWaitMinutes: estimateDoctorWait(doctor) });
});

app.post('/api/doctors/:doctorId/finish', (req, res) => {
  const doctor = getDoctorById(req.params.doctorId);
  if (!doctor) {
    return res.status(404).json({ error: 'Doctor not found.' });
  }
  if (!doctor.current) {
    return res.status(400).json({ error: 'No consultation in progress.' });
  }

  const patient = doctor.current;
  const durationMinutes = Math.max(1, Math.round((Date.now() - patient.startedConsultationAt) / 60000));
  doctor.consultationRecords.push(durationMinutes);
  doctor.current = null;
  patient.status = 'finishedConsultation';
  patient.consultedAt = Date.now();
  patient.latestConsultationMinutes = durationMinutes;

  if (patient.prescribedLab) {
    const targetLab = getLabById(patient.labId) || labs.find((lab) => lab.hospitalId === doctor.hospitalId);
    if (targetLab) {
      patient.status = 'waitingLab';
      patient.enteredQueueAt = Date.now();
      patient.enteredLabAt = Date.now();
      patient.labId = targetLab.id;
      patient.priority = LAB_PRIORITY.prescribed;
      targetLab.queue.push(patient);
      updateLabPriorities(targetLab);
    }
  }

  res.json({ finished: patient, estimatedWaitMinutes: estimateDoctorWait(doctor) });
});

app.post('/api/doctors/:doctorId/break', (req, res) => {
  const doctor = getDoctorById(req.params.doctorId);
  if (!doctor) {
    return res.status(404).json({ error: 'Doctor not found.' });
  }
  if (doctor.onBreak) {
    const durationMinutes = Math.max(1, Math.round((Date.now() - doctor.breakStart) / 60000));
    doctor.breakRecords.push({ startedAt: doctor.breakStart, durationMinutes });
    doctor.onBreak = false;
    doctor.breakStart = null;
    res.json({ message: 'Break ended.', durationMinutes, averageBreaksPerDay: computeStats().averageBreaksPerDay });
  } else {
    doctor.onBreak = true;
    doctor.breakStart = Date.now();
    res.json({ message: 'Break started.' });
  }
});

app.post('/api/labs/:labId/start', (req, res) => {
  const lab = getLabById(req.params.labId);
  if (!lab) {
    return res.status(404).json({ error: 'Lab not found.' });
  }
  if (lab.activePatients.length >= lab.capacity) {
    return res.status(400).json({ error: 'Lab capacity is full.' });
  }
  if (!lab.queue.length) {
    return res.status(400).json({ error: 'No patients in lab queue.' });
  }
  updateLabPriorities(lab);
  const nextPatient = lab.queue.shift();
  nextPatient.status = 'inLab';
  nextPatient.startedLabAt = Date.now();
  lab.activePatients.push(nextPatient);
  res.json({ current: lab.activePatients, estimatedWaitMinutes: estimateLabWait(lab) });
});

app.post('/api/labs/:labId/finish', (req, res) => {
  const lab = getLabById(req.params.labId);
  if (!lab) {
    return res.status(404).json({ error: 'Lab not found.' });
  }
  const patientId = req.body.patientId;
  const activeIndex = patientId
    ? lab.activePatients.findIndex((patient) => patient.id === patientId)
    : 0;
  if (activeIndex < 0 || activeIndex >= lab.activePatients.length) {
    return res.status(400).json({ error: 'No active lab patient found.' });
  }
  const patient = lab.activePatients.splice(activeIndex, 1)[0];
  patient.status = 'labCompleted';
  patient.labCompletedAt = Date.now();
  if (patient.doctorId) {
    const doctor = getDoctorById(patient.doctorId);
    if (doctor) {
      patient.status = 'waitingDoctor';
      patient.enteredQueueAt = Date.now();
      doctor.queue.push(patient);
    }
  }
  res.json({ finished: patient, labQueueLength: lab.queue.length, activePatients: lab.activePatients });
});

app.get('/api/status', (req, res) => {
  labs.forEach(updateLabPriorities);
  const doctorStatus = doctors.map((doctor) => ({
    id: doctor.id,
    name: doctor.name,
    hospitalId: doctor.hospitalId,
    onBreak: doctor.onBreak,
    current: doctor.current,
    queue: doctor.queue,
    queueLength: doctor.queue.length,
    estimatedWaitMinutes: estimateDoctorWait(doctor)
  }));
  const labStatus = labs.map((lab) => ({
    id: lab.id,
    name: lab.name,
    hospitalId: lab.hospitalId,
    queue: lab.queue,
    queueLength: lab.queue.length,
    activePatients: lab.activePatients,
    capacity: lab.capacity,
    estimatedWaitMinutes: estimateLabWait(lab)
  }));
  res.json({ doctors: doctorStatus, labs: labStatus, stats: computeStats() });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Queue management server running on http://localhost:${PORT}`);
});
