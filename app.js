const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { Parser } = require('json2csv');

const app = express();

// Cấu hình Cổng PORT linh hoạt cho Render
const PORT = process.env.PORT || 3000;

// Thư mục lưu file PDF
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
  secret: 'math-hoangyen-secret-2026',
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
  res.status(403).send('Từ chối truy cập: Bắt buộc quyền Admin / Giáo viên!');
}

// Khởi tạo Cơ sở dữ liệu SQLite3
const dbPath = process.env.RENDER ? path.join('/tmp', 'math_hoangyen.db') : path.join(__dirname, 'math_hoangyen.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS math_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      level TEXT NOT NULL,
      topic TEXT,
      pdf_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
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
      FOREIGN KEY(lesson_id) REFERENCES math_lessons(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS math_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      lesson_id INTEGER,
      score INTEGER,
      status TEXT,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.get('SELECT COUNT(*) as count FROM math_lessons', (err, row) => {
    if (!err && row && row.count === 0) {
      const stmt = db.prepare('INSERT INTO math_lessons (code, title, level, topic) VALUES (?, ?, ?, ?)');
      stmt.run('MATH-C1-01', 'Bảng cửu chương & Phép tính cơ bản', 'Cấp 1 (Tiểu học)', 'Số học');
      stmt.run('MATH-C2-01', 'Phương trình bậc nhất một ẩn', 'Cấp 2 (THCS)', 'Đại số');
      stmt.run('MATH-C3-01', 'Đạo hàm & Ứng dụng trong Hình học', 'Cấp 3 (THPT)', 'Giải tích');
      stmt.finalize();
    }
  });
});

// Trang Đăng nhập
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Đăng Nhập - Math with HoangYen</title>
      <style>
        body { font-family: sans-serif; background: #f0fdf4; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 100%; max-width: 360px; border-top: 4px solid #16a34a; box-sizing: border-box; }
        h2 { text-align: center; color: #16a34a; margin-top: 0; }
        .form-group { margin-bottom: 15px; }
        label { display: block; font-weight: bold; margin-bottom: 5px; font-size: 13px; }
        input { width: 100%; padding: 10px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 5px; }
        button { width: 100%; background: #16a34a; color: white; padding: 10px; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; }
        button:hover { background: #15803d; }
        .info { background: #dcfce7; padding: 10px; border-radius: 5px; font-size: 12px; color: #15803d; margin-bottom: 15px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>📐 Math with HoangYen</h2>
        <div class="info">
          <b>Tài khoản hệ thống:</b><br>
          • Giáo viên: <b>admin</b> / <b>123456</b><br>
          • Học sinh: <b>hocsinh</b> / <b>123456</b>
        </div>
        <form action="/login" method="POST">
          <div class="form-group">
            <label>Tên đăng nhập:</label>
            <input type="text" name="username" required placeholder="admin hoặc hocsinh">
          </div>
          <div class="form-group">
            <label>Mật khẩu:</label>
            <input type="password" name="password" required placeholder="••••••">
          </div>
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
    res.send('<script>alert("Tài khoản hoặc mật khẩu không đúng!"); window.location.href="/login";</script>');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// APIs
app.get('/api/lessons', requireLogin, (req, res) => {
  const level = req.query.level || '';
  if (level) {
    db.all('SELECT * FROM math_lessons WHERE level = ? ORDER BY id DESC', [level], (err, rows) => {
      res.json(rows || []);
    });
  } else {
    db.all('SELECT * FROM math_lessons ORDER BY id DESC', (err, rows) => {
      res.json(rows || []);
    });
  }
});

app.post('/api/lessons', requireLogin, requireAdmin, upload.single('pdf'), (req, res) => {
  const { code, title, level, topic } = req.body;
  const pdfPath = req.file ? `/uploads/${req.file.filename}` : null;

  const stmt = db.prepare('INSERT INTO math_lessons (code, title, level, topic, pdf_path) VALUES (?, ?, ?, ?, ?)');
  stmt.run(code, title, level, topic, pdfPath, (err) => {
    if (err) {
      return res.status(400).send('Lỗi: Mã bài học đã tồn tại! <a href="/">Quay lại</a>');
    }
    res.redirect('/');
  });
});

app.delete('/api/lessons/:id', requireLogin, requireAdmin, (req, res) => {
  db.get('SELECT pdf_path FROM math_lessons WHERE id = ?', [req.params.id], (err, lesson) => {
    if (lesson && lesson.pdf_path) {
      const fullPath = path.join(uploadDir, path.basename(lesson.pdf_path));
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    db.run('DELETE FROM math_lessons WHERE id = ?', [req.params.id]);
    db.run('DELETE FROM math_quizzes WHERE lesson_id = ?', [req.params.id]);
    res.json({ success: true });
  });
});

app.get('/api/lessons/:id/quizzes', requireLogin, (req, res) => {
  db.all('SELECT id, question, option_a, option_b, option_c, option_d FROM math_quizzes WHERE lesson_id = ?', [req.params.id], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/quizzes', requireLogin, requireAdmin, (req, res) => {
  const { lesson_id, question, option_a, option_b, option_c, option_d, correct_option } = req.body;
  const stmt = db.prepare(`
    INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(lesson_id, question, option_a, option_b, option_c, option_d, correct_option, () => {
    res.redirect('/');
  });
});

app.post('/api/submit-quiz', requireLogin, (req, res) => {
  const { lesson_id, answers } = req.body;
  db.all('SELECT id, correct_option FROM math_quizzes WHERE lesson_id = ?', [lesson_id], (err, quizzes) => {
    if (!quizzes || quizzes.length === 0) {
      return res.json({ score: 100, status: 'Đã học xong lý thuyết' });
    }

    let correctCount = 0;
    quizzes.forEach(q => {
      if (answers && answers[q.id] === q.correct_option) {
        correctCount++;
      }
    });

    const score = Math.round((correctCount / quizzes.length) * 100);
    const status = score >= 80 ? 'XUẤT SẮC' : (score >= 50 ? 'ĐẠT' : 'CẦN ÔN LẠI');

    const stmt = db.prepare('INSERT INTO math_results (username, lesson_id, score, status) VALUES (?, ?, ?, ?)');
    stmt.run(req.session.user.username, lesson_id, score, status, () => {
      res.json({ score, status, correctCount, total: quizzes.length });
    });
  });
});

app.get('/api/export-results', requireLogin, (req, res) => {
  db.all(`
    SELECT r.id, r.username, l.title as lesson_name, l.level, r.score, r.status, r.completed_at 
    FROM math_results r 
    JOIN math_lessons l ON r.lesson_id = l.id
  `, (err, results) => {
    const json2csvParser = new Parser({ fields: ['id', 'username', 'lesson_name', 'level', 'score', 'status', 'completed_at'] });
    const csv = json2csvParser.parse(results || []);

    res.header('Content-Type', 'text/csv');
    res.attachment(`BangDiem_Math_${Date.now()}.csv`);
    res.send(csv);
  });
});

// Trang chính
app.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Math with HoangYen Online</title>
      <style>
        body { font-family: sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
        header { background: #15803d; color: white; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; }
        .container { max-width: 1200px; margin: 20px auto; padding: 0 15px; display: grid; grid-template-columns: ${user.role === 'Admin' ? '320px 1fr' : '1fr'}; gap: 20px; }
        .card { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; }
        .filter-btn { background: #e2e8f0; border: none; padding: 6px 12px; border-radius: 15px; cursor: pointer; font-weight: bold; margin-right: 5px; }
        .filter-btn.active { background: #16a34a; color: white; }
        .lesson-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 15px; margin-top: 15px; }
        .lesson-card { background: #f1f5f9; padding: 15px; border-radius: 8px; }
        button { background: #16a34a; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-weight: bold; }
        iframe { width: 100%; height: 450px; border: 1px solid #cbd5e1; margin-top: 10px; border-radius: 5px; }
      </style>
    </head>
    <body>
      <header>
        <h2>📐 Math with HoangYen</h2>
        <div>👤 ${user.username} (${user.role}) | <a href="/logout" style="color:white;">Đăng xuất</a></div>
      </header>

      <div class="container">
        ${user.role === 'Admin' ? `
        <div class="card">
          <h3>➕ Thêm Bài Học</h3>
          <form action="/api/lessons" method="POST" enctype="multipart/form-data">
            <p><input type="text" name="code" placeholder="Mã bài" required style="width:100%;"></p>
            <p><input type="text" name="title" placeholder="Tên bài" required style="width:100%;"></p>
            <p>
              <select name="level" style="width:100%;">
                <option value="Cấp 1 (Tiểu học)">Cấp 1</option>
                <option value="Cấp 2 (THCS)">Cấp 2</option>
                <option value="Cấp 3 (THPT)">Cấp 3</option>
              </select>
            </p>
            <p><input type="text" name="topic" placeholder="Chuyên đề" style="width:100%;"></p>
            <p><input type="file" name="pdf" accept="application/pdf"></p>
            <button type="submit" style="width:100%;">Tải Bài Lên</button>
          </form>
        </div>
        ` : ''}

        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3>📚 Danh Sách Bài Học</h3>
            <a href="/api/export-results"><button style="background:#0284c7;">📥 Xuất Bảng Điểm</button></a>
          </div>

          <div>
            <button class="filter-btn active" onclick="filterLevel('', this)">Tất Cả</button>
            <button class="filter-btn" onclick="filterLevel('Cấp 1 (Tiểu học)', this)">Cấp 1</button>
            <button class="filter-btn" onclick="filterLevel('Cấp 2 (THCS)', this)">Cấp 2</button>
            <button class="filter-btn" onclick="filterLevel('Cấp 3 (THPT)', this)">Cấp 3</button>
          </div>

          <div class="lesson-grid" id="lessonList"></div>

          <div id="studyArea" style="display:none; margin-top:20px;">
            <h3 id="lessonTitle">Đang Học:</h3>
            <iframe id="pdfViewer" src="about:blank"></iframe>
            <div id="quizBox" style="margin-top:15px; background:#f0fdf4; padding:15px; border-radius:8px;">
              <h4>📝 Bài Tập Trắc Nghiệm</h4>
              <form id="quizForm"><div id="quizQuestions"></div></form>
              <button onclick="submitQuiz()" style="margin-top:10px;">Nộp Bài</button>
              <p id="quizResult" style="font-weight:bold;"></p>
            </div>
          </div>
        </div>
      </div>

      <script>
        let currentLessonId = null;
        let selectedLevel = '';

        async function filterLevel(lvl, btn) {
          selectedLevel = lvl;
          document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          loadLessons();
        }

        async function loadLessons() {
          const res = await fetch('/api/lessons?level=' + encodeURIComponent(selectedLevel));
          const lessons = await res.json();
          const list = document.getElementById('lessonList');
          list.innerHTML = '';
          lessons.forEach(l => {
            list.innerHTML += \`
              <div class="lesson-card">
                <small><b>\${l.level}</b></small>
                <h4>\${l.title}</h4>
                <button onclick="startStudy(\${l.id}, '\${l.title}', '\${l.pdf_path}')">Vào Học</button>
              </div>
            \`;
          });
        }

        async function startStudy(id, title, pdf) {
          currentLessonId = id;
          document.getElementById('studyArea').style.display = 'block';
          document.getElementById('lessonTitle').innerText = '📖 ' + title;
          document.getElementById('pdfViewer').src = pdf || 'about:blank';
          
          const res = await fetch('/api/lessons/' + id + '/quizzes');
          const quizzes = await res.json();
          const qBox = document.getElementById('quizQuestions');
          qBox.innerHTML = '';
          quizzes.forEach((q, i) => {
            qBox.innerHTML += \`
              <p><b>Câu \${i+1}: \${q.question}</b></p>
              <label><input type="radio" name="quiz_\${q.id}" value="A"> A. \${q.option_a}</label><br>
              <label><input type="radio" name="quiz_\${q.id}" value="B"> B. \${q.option_b}</label><br>
              <label><input type="radio" name="quiz_\${q.id}" value="C"> C. \${q.option_c}</label><br>
              <label><input type="radio" name="quiz_\${q.id}" value="D"> D. \${q.option_d}</label>
            \`;
          });
        }

        async function submitQuiz() {
          if (!currentLessonId) return;
          const form = document.getElementById('quizForm');
          const formData = new FormData(form);
          const answers = {};
          for (let [k, v] of formData.entries()) {
            if (k.startsWith('quiz_')) answers[k.replace('quiz_', '')] = v;
          }
          const res = await fetch('/api/submit-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lesson_id: currentLessonId, answers })
          });
          const resData = await res.json();
          document.getElementById('quizResult').innerText = \`Kết quả: \${resData.score}/100 - Xếp loại: \${resData.status}\`;
        }

        loadLessons();
      </script>
    </body>
    </html>
  `);
});

// Khởi chạy Server trên 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server đang chạy tại cổng: ${PORT}`);
});
