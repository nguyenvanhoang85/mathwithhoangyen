const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { Parser } = require('json2csv');

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình lưu trữ tệp (Dùng /tmp trên Render)
const uploadDir = process.env.RENDER ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));

app.use(session({
  secret: 'math-hoangyen-auto-sync-2026',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 8 * 3600000 }
}));

function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'Admin') return next();
  res.status(403).send('Từ chối truy cập: Quyền Hạn Bắt Buộc là Admin/Giáo viên!');
}

// Khởi tạo Database
let db;
const dbPath = process.env.RENDER ? path.join('/tmp', 'math_hoangyen.db') : path.join(__dirname, 'math_hoangyen.db');

function saveDatabase() {
  if (db) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    } catch (err) {
      console.error('Lỗi lưu Database:', err);
    }
  }
}

function parseResult(res) {
  if (!res || res.length === 0) return [];
  const columns = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    columns.forEach((col, idx) => { obj[col] = row[idx]; });
    return obj;
  });
}

async function initDB() {
  try {
    const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    const SQL = await initSqlJs({
      locateFile: file => fs.existsSync(wasmPath) ? wasmPath : `https://sql.js.org/dist/${file}`
    });

    if (fs.existsSync(dbPath)) {
      db = new SQL.Database(fs.readFileSync(dbPath));
    } else {
      db = new SQL.Database();
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS math_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        level TEXT NOT NULL,
        topic TEXT,
        description TEXT,
        pdf_path TEXT,
        is_auto_synced INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS math_quizzes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id INTEGER,
        question TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,
        correct_option TEXT NOT NULL,
        explanation TEXT
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS math_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        lesson_id INTEGER,
        score INTEGER,
        status TEXT,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    saveDatabase();
    console.log('✅ Cơ sở dữ liệu đã sẵn sàng!');
  } catch (err) {
    console.error('❌ Lỗi DB:', err);
  }
}

// ----------------- ENGINE TỰ ĐỘNG CẬP NHẬT TÀI LIỆU (AUTO-SYNC ENGINE) ----------------- //

// Hàm tự động cập nhật / đồng bộ tài liệu từ kho lưu trữ trung tâm hoặc Google Sheets/API
async function autoSyncDocuments() {
  console.log('🔄 Đang kiểm tra và tự động cập nhật tài liệu mới...');
  
  // Danh sách các bài giảng tự động cập nhật mẫu (Có thể thay thế bằng API Google Drive/Sheets)
  const remoteLessons = [
    {
      code: 'AUTO-MATH-C1-10',
      title: 'Tự Động Cập Nhật: Bảng Cửu Chương & Mẹo Nhẩm Nhanh',
      level: 'Cấp 1 (Tiểu học)',
      topic: 'Số Học',
      description: 'Tài liệu tự động tải từ hệ thống kho giáo trình trung tâm.',
      pdf_path: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' // Link PDF giáo trình online
    },
    {
      code: 'AUTO-MATH-C2-05',
      title: 'Tự Động Cập Nhật: Chuyên Đề Bất Đẳng Thức Ôn Thi Vào 10',
      level: 'Cấp 2 (THCS)',
      topic: 'Đại Số',
      description: 'Cập nhật đề thi & lời giải chi tiết mới nhất.',
      pdf_path: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
    }
  ];

  try {
    remoteLessons.forEach(lesson => {
      const existing = parseResult(db.exec('SELECT * FROM math_lessons WHERE code = ?', [lesson.code]));
      if (existing.length === 0) {
        db.run(
          'INSERT INTO math_lessons (code, title, level, topic, description, pdf_path, is_auto_synced) VALUES (?, ?, ?, ?, ?, ?, 1)',
          [lesson.code, lesson.title, lesson.level, lesson.topic, lesson.description, lesson.pdf_path]
        );
        console.log(`✨ Đã tự động thêm bài giảng mới: ${lesson.title}`);
      }
    });
    saveDatabase();
  } catch (err) {
    console.error('❌ Lỗi tự động đồng bộ:', err);
  }
}

// Lên lịch tự động kiểm tra và cập nhật bài giảng mỗi 30 phút (1800000 ms)
setInterval(() => {
  autoSyncDocuments();
}, 1800000);

// API Kích hoạt cập nhật thủ công (Dành cho Giáo viên ấn nút "Cập nhật ngay")
app.post('/api/sync-now', requireLogin, requireAdmin, async (req, res) => {
  await autoSyncDocuments();
  res.json({ success: true, message: 'Đã hoàn tất tự động cập nhật tài liệu mới nhất!' });
});

// ----------------- ROUTES CHÍNH ----------------- //

app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <title>Đăng Nhập - Math HoangYen Auto-Sync</title>
      <style>
        body { font-family: sans-serif; background: #e0f2fe; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); width: 100%; max-width: 380px; }
        h2 { text-align: center; color: #0284c7; }
        input { width: 100%; padding: 10px; margin: 8px 0 15px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; background: #0284c7; color: white; padding: 11px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>📐 Math HoangYen</h2>
        <form action="/login" method="POST">
          <label>Tên tài khoản:</label>
          <input type="text" name="username" placeholder="admin hoặc hocsinh" required>
          <label>Mật khẩu:</label>
          <input type="password" name="password" placeholder="••••••" required>
          <button type="submit">Đăng Nhập</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === '123456') {
    req.session.user = { username: 'admin', role: 'Admin' };
    res.redirect('/');
  } else if (username === 'hocsinh' && password === '123456') {
    req.session.user = { username: 'hocsinh', role: 'Student' };
    res.redirect('/');
  } else {
    res.send('<script>alert("Sai tài khoản hoặc mật khẩu!"); window.location.href="/login";</script>');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// APIs Lấy Bài học
app.get('/api/lessons', requireLogin, (req, res) => {
  if (!db) return res.json([]);
  const level = req.query.level || '';
  const stmt = level ? db.exec('SELECT * FROM math_lessons WHERE level = ? ORDER BY id DESC', [level]) : db.exec('SELECT * FROM math_lessons ORDER BY id DESC');
  res.json(parseResult(stmt));
});

// App UI
app.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Hệ Thống Tự Động Cập Nhật Bài Giảng</title>
      <style>
        :root { --primary: #0284c7; --bg: #f8fafc; }
        body { font-family: sans-serif; margin: 0; background: var(--bg); color: #0f172a; }
        header { background: var(--primary); color: white; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; }
        .container { max-width: 1200px; margin: 20px auto; padding: 0 20px; }
        .card { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px; }
        .btn { background: var(--primary); color: white; border: none; padding: 9px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; }
        .btn-sync { background: #16a34a; }
        .btn-sync:hover { background: #15803d; }
        .lesson-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; margin-top: 15px; }
        .lesson-card { background: white; border: 1px solid #e2e8f0; border-top: 4px solid var(--primary); padding: 15px; border-radius: 8px; position: relative; }
        .badge-auto { background: #dcfce7; color: #166534; font-size: 11px; padding: 3px 6px; border-radius: 4px; font-weight: bold; position: absolute; top: 10px; right: 10px; }
        iframe { width: 100%; height: 500px; border: 1px solid #cbd5e1; border-radius: 6px; margin-top: 15px; }
      </style>
    </head>
    <body>
      <header>
        <div><b>📐 Math HoangYen - Auto Sync Engine</b></div>
        <div>👤 ${user.username} (${user.role}) | <a href="/logout" style="color:white;">Đăng xuất</a></div>
      </header>

      <div class="container">
        <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h2 style="margin:0;">📚 Thư Viện Bài Giảng & Tài Liệu</h2>
            <small style="color:#64748b;">Hệ thống tự động kiểm tra và cập nhật bài giảng mới mỗi 30 phút.</small>
          </div>
          ${user.role === 'Admin' ? `
            <button class="btn btn-sync" onclick="triggerAutoSync()">🔄 Tự Động Cập Nhật Ngay</button>
          ` : ''}
        </div>

        <div class="card">
          <div id="lessonGrid" class="lesson-grid"></div>
        </div>

        <div class="card" id="pdfCard" style="display:none;">
          <h3 id="pdfTitle">Nội dung bài học</h3>
          <iframe id="pdfFrame" src="about:blank"></iframe>
        </div>
      </div>

      <script>
        async function loadLessons() {
          const res = await fetch('/api/lessons');
          const lessons = await res.json();
          const grid = document.getElementById('lessonGrid');
          grid.innerHTML = '';

          lessons.forEach(l => {
            grid.innerHTML += \`
              <div class="lesson-card">
                \${l.is_auto_synced ? '<span class="badge-auto">⚡ Auto Synced</span>' : ''}
                <small style="color:var(--primary); font-weight:bold;">\${l.level}</small>
                <h4 style="margin:8px 0;">\${l.title}</h4>
                <p style="font-size:13px; color:#64748b;">\${l.description || 'Chưa có mô tả'}</p>
                <button class="btn" onclick="viewPdf('\${l.title}', '\${l.pdf_path}')">Xem Tài Liệu</button>
              </div>
            \`;
          });
        }

        function viewPdf(title, path) {
          document.getElementById('pdfCard').style.display = 'block';
          document.getElementById('pdfTitle').innerText = '📖 ' + title;
          document.getElementById('pdfFrame').src = path;
        }

        async function triggerAutoSync() {
          const res = await fetch('/api/sync-now', { method: 'POST' });
          const data = await res.json();
          alert(data.message);
          loadLessons();
        }

        loadLessons();
      </script>
    </body>
    </html>
  `);
});

// Khởi chạy Server
initDB().then(() => {
  autoSyncDocuments(); // Chạy cập nhật lần đầu khi mở máy chủ
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server đang chạy thành công tại cổng: ${PORT}`);
  });
});
