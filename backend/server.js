require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const connectDB = require('./config/db');

const app = express();

app.enable('trust proxy');

connectDB();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    secure: 'auto',
    httpOnly: true,
    sameSite: process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax')
  }
}));

app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/schools', require('./routes/schools'));
app.use('/api/students', require('./routes/students'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/parents', require('./routes/parents'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/files', require('./routes/files'));
app.use('/api/trash', require('./routes/trash'));
app.use('/api/academic', require('./routes/academic'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

const seedSuperAdmin = async () => {
  const User = require('./models/User');
  const bcrypt = require('bcryptjs');
  try {
    const exists = await User.findOne({ role: 'super_admin' });
    if (!exists) {
      await User.create({
        fullName: 'Super Admin',
        email: 'admin@feesledger.com',
        passwordHash: await bcrypt.hash('admin123', 10),
        role: 'super_admin',
        status: 'active'
      });
      console.log('Super Admin seeded: admin@feesledger.com / admin123');
    } else if (!exists.passwordHash) {
      exists.passwordHash = await bcrypt.hash('admin123', 10);
      exists.fullName = exists.fullName || 'Super Admin';
      await exists.save();
      console.log('Super Admin fixed: passwordHash restored');
    }
  } catch (error) {
    console.error('Seed error:', error.message);
  }
};

const PORT = process.env.PORT || 4000;
mongoose.connection.once('open', () => {
  seedSuperAdmin();
  app.listen(PORT, () => console.log(`FeesLedger running on port ${PORT}`));
});
