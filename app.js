const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { Parser } = require('json2csv');

const app = express();
// Cấu hình Cổng linh hoạt cho Render hoặc Localhost
const PORT = process.env.PORT || 3000;

// 1. Cấu hình Upload bài giảng PDF (sử dụng thư mục tạm /tmp trên Server Cloud)
const uploadDir = process.env.RENDER ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// 2. Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));

app.use(session({
  secret: 'math-with-hoangyen-online-2026-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 8 * 3600000 } // 8 tiếng
}));

function requireLogin(req, res, next) {
  if (req.session && req.session.user) next();
  else res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'Admin') next();
  else res.status(403).send('Từ chối truy cập: Bắt buộc quyền Giáo viên / Admin!');
}

// 3. Cơ sở dữ liệu SQLite
const dbPath = process.env.RENDER ? path.join('/tmp', 'math_hoangyen.db') : path.join(__dirname, 'math_hoangyen.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS math_lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    level TEXT NOT NULL,
    topic TEXT,
    pdf_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

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
  );

  CREATE TABLE IF NOT EXISTS math_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    lesson_id INTEGER,
    score INTEGER,
    status TEXT,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Dữ liệu mẫu ban đầu
const count = db.prepare('SELECT COUNT(*) as count FROM math_lessons').get().count;
if (count === 0) {
  const insertLesson = db.prepare('INSERT INTO math_lessons (code, title, level, topic) VALUES (?, ?, ?, ?)');
  insertLesson.run('MATH-C1-01', 'Bảng cửu chương & Phép tính cơ bản', 'Cấp 1 (Tiểu học)', 'Số học');
  insertLesson.run('MATH-C2-01', 'Phương trình bậc nhất một ẩn', 'Cấp 2 (THCS)', 'Đại số');
  insertLesson.run('MATH-C3-01', 'Đạo hàm & Ứng dụng trong Hình học', 'Cấp 3 (THPT)', 'Giải tích');
}

// ================= GIAO DIỆN ĐĂNG NHẬP =================

app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Đăng Nhập - Math with HoangYen</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0fdf4; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: white; padding: 35px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); width: 100%; max-width: 360px; border-top: 5px solid #16a34a; box-sizing: border-box; }
        h2 { text-align: center; color: #16a34a; margin-top: 0; font-size: 22px; }
        .form-group { margin-bottom: 16px; }
        label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 13px; color: #334155; }
        input { width: 100%; padding: 10px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; }
        button { width: 100%; background: #16a34a; color: white; padding: 11px; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px; }
        button:hover { background: #15803d; }
        .info { background: #dcfce7; padding: 12px; border-radius: 6px; font-size: 12px; color: #15803d; margin-bottom: 20px; border-left: 4px solid #16a34a; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>📐 Math with HoangYen</h2>
        <div class="info">
          <b>Tài khoản truy cập hệ thống:</b><br>
          • Giáo viên / Admin: <b>admin</b> / <b>123456</b><br>
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
          <button type="submit">Vào Học Toán Ngay ➔</button>
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
    res.send('<script>alert("Tên đăng nhập hoặc mật khẩu không đúng!"); window.location.href="/login";</script>');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ================= APIS =================

app.get('/api/lessons', requireLogin, (req, res) => {
  const level = req.query.level || '';
  let stmt;
  if (level) {
    stmt = db.prepare('SELECT * FROM math_lessons WHERE level = ? ORDER BY id DESC');
    res.json(stmt.all(level));
  } else {
    stmt = db.prepare('SELECT * FROM math_lessons ORDER BY id DESC');
    res.json(stmt.all());
  }
});

app.post('/api/lessons', requireLogin, requireAdmin, upload.single('pdf'), (req, res) => {
  const { code, title, level, topic } = req.body;
  const pdfPath = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const stmt = db.prepare('INSERT INTO math_lessons (code, title, level, topic, pdf_path) VALUES (?, ?, ?, ?, ?)');
    stmt.run(code, title, level, topic, pdfPath);
    res.redirect('/');
  } catch (err) {
    res.status(400).send('Lỗi: Mã bài học đã tồn tại! <a href="/">Quay lại trang chủ</a>');
  }
});

app.delete('/api/lessons/:id', requireLogin, requireAdmin, (req, res) => {
  const lesson = db.prepare('SELECT pdf_path FROM math_lessons WHERE id = ?').get(req.params.id);
  if (lesson && lesson.pdf_path) {
    const fullPath = path.join(uploadDir, path.basename(lesson.pdf_path));
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }
  db.prepare('DELETE FROM math_lessons WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM math_quizzes WHERE lesson_id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/lessons/:id/quizzes', requireLogin, (req, res) => {
  const quizzes = db.prepare('SELECT id, question, option_a, option_b, option_c, option_d FROM math_quizzes WHERE lesson_id = ?').all(req.params.id);
  res.json(quizzes);
});

app.post('/api/quizzes', requireLogin, requireAdmin, (req, res) => {
  const { lesson_id, question, option_a, option_b, option_c, option_d, correct_option } = req.body;
  db.prepare(`
    INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(lesson_id, question, option_a, option_b, option_c, option_d, correct_option);
  res.redirect('/');
});

app.post('/api/submit-quiz', requireLogin, (req, res) => {
  const { lesson_id, answers } = req.body;
  const quizzes = db.prepare('SELECT id, correct_option FROM math_quizzes WHERE lesson_id = ?').all(lesson_id);
  
  if (quizzes.length === 0) {
    return res.json({ score: 100, status: 'Đã học xong lý thuyết' });
  }

  let correctCount = 0;
  quizzes.forEach(q => {
    if (answers && answers[q.id] === q.correct_option) {
      correctCount++;
    }
  });

  const score = Math.round((correctCount / quizzes.length) * 100);
  const status = score >= 80 ? 'XUẤT SẮC (Đạt)' : (score >= 50 ? 'ĐẠT (Trung bình)' : 'CẦN ÔN LẠI');

  db.prepare('INSERT INTO math_results (username, lesson_id, score, status) VALUES (?, ?, ?, ?)').run(
    req.session.user.username,
    lesson_id,
    score,
    status
  );

  res.json({ score, status, correctCount, total: quizzes.length });
});

app.get('/api/export-results', requireLogin, (req, res) => {
  const results = db.prepare(`
    SELECT r.id, r.username, l.title as lesson_name, l.level, r.score, r.status, r.completed_at 
    FROM math_results r 
    JOIN math_lessons l ON r.lesson_id = l.id
  `).all();
  
  const fields = ['id', 'username', 'lesson_name', 'level', 'score', 'status', 'completed_at'];
  const json2csvParser = new Parser({ fields });
  const csv = json2csvParser.parse(results);

  res.header('Content-Type', 'text/csv');
  res.attachment(`BangDiem_MathWithHoangYen_${Date.now()}.csv`);
  return res.send(csv);
});

// ================= GIAO DIỆN CHÍNH =================

app.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Math with HoangYen - Nền Tảng Học Toán Online</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background-color: #f8fafc; color: #0f172a; }
        header { background: #15803d; color: white; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); flex-wrap: wrap; gap: 10px; }
        header h1 { margin: 0; font-size: 20px; font-weight: 700; }
        .user-info { background: #166534; padding: 6px 14px; border-radius: 20px; font-size: 13px; }
        .btn-logout { color: #fecdd3; text-decoration: none; font-weight: 600; margin-left: 10px; }

        .container { max-width: 1350px; margin: 20px auto; padding: 0 15px; display: grid; grid-template-columns: ${user.role === 'Admin' ? '340px 1fr' : '1fr'}; gap: 20px; }
        @media (max-width: 900px) { .container { grid-template-columns: 1fr; } }
        
        .card { background: white; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; box-shadow: 0 2px 6px rgba(0,0,0,0.03); }
        h3 { margin-top: 0; color: #15803d; font-size: 17px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px; }

        .filter-bar { display: flex; gap: 8px; margin-bottom: 15px; flex-wrap: wrap; }
        .filter-btn { background: #e2e8f0; color: #334155; padding: 7px 13px; border-radius: 20px; border: none; cursor: pointer; font-weight: 600; font-size: 12px; }
        .filter-btn.active { background: #16a34a; color: white; }

        .form-group { margin-bottom: 12px; }
        label { display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #475569; }
        input, select { width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; }

        button { background-color: #16a34a; color: white; padding: 9px 15px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; }
        button:hover { background-color: #15803d; }
        .btn-del { background-color: #ef4444; padding: 4px 8px; font-size: 11px; }

        .lesson-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 15px; }
        .lesson-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px; display: flex; flex-direction: column; justify-content: space-between; }
        .lesson-card h4 { margin: 6px 0; color: #0f172a; font-size: 15px; }
        
        .badge-level { font-size: 11px; padding: 3px 8px; border-radius: 12px; font-weight: 600; display: inline-block; }
        .lvl-c1 { background: #dbeafe; color: #1e40af; }
        .lvl-c2 { background: #fef3c7; color: #b45309; }
        .lvl-c3 { background: #fce7f3; color: #9d174d; }

        iframe { width: 100%; height: 480px; border: 1px solid #cbd5e1; border-radius: 8px; margin-top: 10px; }
        .quiz-box { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 10px; margin-top: 20px; }
        .quiz-item { margin-bottom: 12px; background: white; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <header>
        <h1>📐 Math with HoangYen Online</h1>
        <div class="user-info">
          👤 <b>${user.username}</b> (${user.role === 'Admin' ? 'Giáo Viên' : 'Học Sinh'}) | 
          <a href="/logout" class="btn-logout">Đăng xuất</a>
        </div>
      </header>

      <div class="container">
        ${user.role === 'Admin' ? `
        <div>
          <div class="card" style="margin-bottom: 20px;">
            <h3>➕ Thêm Bài Học Toán Mới</h3>
            <form action="/api/lessons" method="POST" enctype="multipart/form-data">
              <div class="form-group">
                <label>Mã Bài Học:</label>
                <input type="text" name="code" placeholder="VD: MATH-C1-02" required>
              </div>
              <div class="form-group">
                <label>Tên Bài Học:</label>
                <input type="text" name="title" placeholder="VD: Hình học không gian" required>
              </div>
              <div class="form-group">
                <label>Cấp Học:</label>
                <select name="level" required>
                  <option value="Cấp 1 (Tiểu học)">Cấp 1 (Tiểu học)</option>
                  <option value="Cấp 2 (THCS)">Cấp 2 (THCS)</option>
                  <option value="Cấp 3 (THPT)">Cấp 3 (THPT)</option>
                </select>
              </div>
              <div class="form-group">
                <label>Chuyên Đề:</label>
                <input type="text" name="topic" placeholder="VD: Đại số, Hình học...">
              </div>
              <div class="form-group">
                <label>File Bài Giảng PDF:</label>
                <input type="file" name="pdf" accept="application/pdf">
              </div>
              <button type="submit" style="width: 100%;">Tải Bài Giảng Lên</button>
            </form>
          </div>

          <div class="card">
            <h3>❓ Tạo Trắc Nghiệm Toán</h3>
            <form action="/api/quizzes" method="POST">
              <div class="form-group">
                <label>Chọn Bài Học:</label>
                <select name="lesson_id" id="lessonSelect" required></select>
              </div>
              <div class="form-group">
                <label>Câu Hỏi Toán:</label>
                <input type="text" name="question" required placeholder="VD: 2x + 4 = 10 thì x = ?">
              </div>
              <div class="form-group"><label>Đáp án A:</label><input type="text" name="option_a" required></div>
              <div class="form-group"><label>Đáp án B:</label><input type="text" name="option_b" required></div>
              <div class="form-group"><label>Đáp án C:</label><input type="text" name="option_c" required></div>
              <div class="form-group"><label>Đáp án D:</label><input type="text" name="option_d" required></div>
              <div class="form-group">
                <label>Đáp án Đúng:</label>
                <select name="correct_option">
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
              </div>
              <button type="submit" style="width: 100%; background:#059669;">➕ Thêm Câu Hỏi</button>
            </form>
          </div>
        </div>
        ` : ''}

        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <h3>📚 Chương Trình Toán Học Cấp 1 - 2 - 3</h3>
            <a href="/api/export-results"><button style="background:#0284c7;">📥 Xuất Bảng Điểm (CSV)</button></a>
          </div>

          <div class="filter-bar">
            <button class="filter-btn active" onclick="filterLevel('', this)">Tất Cả</button>
            <button class="filter-btn" onclick="filterLevel('Cấp 1 (Tiểu học)', this)">🏫 Cấp 1 (Tiểu Học)</button>
            <button class="filter-btn" onclick="filterLevel('Cấp 2 (THCS)', this)">🏫 Cấp 2 (THCS)</button>
            <button class="filter-btn" onclick="filterLevel('Cấp 3 (THPT)', this)">🏫 Cấp 3 (THPT)</button>
          </div>

          <div class="lesson-grid" id="lessonList"></div>

          <div id="studyArea" style="display:none; margin-top:25px;">
            <h3 id="currentLessonTitle">Đang Học: </h3>
            <iframe id="pdfViewer" src="about:blank"></iframe>

            <div class="quiz-box">
              <h3>📝 Luyện Tập Trắc Nghiệm</h3>
              <form id="quizForm">
                <div id="quizQuestions"></div>
                <button type="button" onclick="submitQuiz()" style="margin-top:10px; background:#16a34a;">Nộp Bài Chấm Điểm ➔</button>
              </form>
              <div id="quizResult" style="margin-top:15px; font-weight:bold; font-size:15px;"></div>
            </div>
          </div>
        </div>
      </div>

      <script>
        const userRole = "${user.role}";
        let currentLessonId = null;
        let selectedLevel = '';

        async function filterLevel(level, btn) {
          selectedLevel = level;
          document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          loadLessons();
        }

        async function loadLessons() {
          const res = await fetch('/api/lessons?level=' + encodeURIComponent(selectedLevel));
          const lessons = await res.json();

          const listEl = document.getElementById('lessonList');
          listEl.innerHTML = '';

          const selectEl = document.getElementById('lessonSelect');
          if (selectEl) selectEl.innerHTML = '';

          lessons.forEach(l => {
            if (selectEl) {
              selectEl.innerHTML += \`<option value="\${l.id}">[\${l.level}] \${l.title}</option>\`;
            }

            let badgeClass = 'lvl-c1';
            if (l.level.includes('Cấp 2')) badgeClass = 'lvl-c2';
            if (l.level.includes('Cấp 3')) badgeClass = 'lvl-c3';

            const card = document.createElement('div');
            card.className = 'lesson-card';
            card.innerHTML = \`
              <div>
                <span class="badge-level \${badgeClass}">\${l.level}</span>
                <small style="color:#64748b; font-weight:600; margin-left:4px;">• \${l.topic || 'Chuyên đề'}</small>
                <h4>\${l.title}</h4>
                <div style="font-size:12px; color:#64748b;">Mã: \${l.code}</div>
              </div>
              <div style="margin-top:12px; display:flex; gap:6px;">
                <button onclick="startStudy(\${l.id}, '\${l.title}', '\${l.pdf_path}')">📐 Vào Học</button>
                \${userRole === 'Admin' ? \`<button class="btn-del" onclick="deleteLesson(\${l.id})">❌ Xóa</button>\` : ''}
              </div>
            \`;
            listEl.appendChild(card);
          });
        }

        async function startStudy(id, title, pdfPath) {
          currentLessonId = id;
          document.getElementById('studyArea').style.display = 'block';
          document.getElementById('currentLessonTitle').innerText = '📖 Bài Giảng: ' + title;
          document.getElementById('pdfViewer').src = pdfPath || 'about:blank';
          document.getElementById('quizResult').innerText = '';

          const res = await fetch(\`/api/lessons/\${id}/quizzes\`);
          const quizzes = await res.json();
          const qContainer = document.getElementById('quizQuestions');
          qContainer.innerHTML = '';

          if (quizzes.length === 0) {
            qContainer.innerHTML = '<p style="color:#666;">(Chưa có câu hỏi trắc nghiệm cho bài học này)</p>';
            return;
          }

          quizzes.forEach((q, idx) => {
            qContainer.innerHTML += \`
              <div class="quiz-item">
                <p><b>Câu \${idx + 1}: \${q.question}</b></p>
                <label><input type="radio" name="quiz_\${q.id}" value="A"> A. \${q.option_a}</label><br>
                <label><input type="radio" name="quiz_\${q.id}" value="B"> B. \${q.option_b}</label><br>
                <label><input type="radio" name="quiz_\${q.id}" value="C"> C. \${q.option_c}</label><br>
                <label><input type="radio" name="quiz_\${q.id}" value="D"> D. \${q.option_d}</label>
              </div>
            \`;
          });
        }

        async function submitQuiz() {
          if (!currentLessonId) return;

          const form = document.getElementById('quizForm');
          const formData = new FormData(form);
          const answers = {};

          for (let [key, val] of formData.entries()) {
            if (key.startsWith('quiz_')) {
              const quizId = key.replace('quiz_', '');
              answers[quizId] = val;
            }
          }

          const res = await fetch('/api/submit-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lesson_id: currentLessonId, answers })
          });

          const result = await res.json();
          const resultEl = document.getElementById('quizResult');
          
          if (result.score >= 80) {
            resultEl.style.color = '#15803d';
            resultEl.innerText = \`🏆 Tuyệt vời! Bạn đạt \${result.score}/100 điểm (\${result.correctCount}/\${result.total} câu đúng). ĐÁNH GIÁ: \${result.status}\`;
          } else {
            resultEl.style.color = '#b45309';
            resultEl.innerText = \`📊 Bạn đạt \${result.score}/100 điểm (\${result.correctCount}/\${result.total} câu đúng). ĐÁNH GIÁ: \${result.status}\`;
          }
        }

        async function deleteLesson(id) {
          if (confirm('Bạn có chắc chắn muốn xóa bài học này không?')) {
            await fetch('/api/lessons/' + id, { method: 'DELETE' });
            loadLessons();
            document.getElementById('studyArea').style.display = 'none';
          }
        }

        loadLessons();
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Math with HoangYen Server dang chay tai Port: ${PORT}`);
});