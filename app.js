const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { Parser } = require('json2csv');

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình thư mục uploads
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
  secret: 'math-hoangyen-pro-2026',
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
  res.status(403).send('Từ chối truy cập: Bắt buộc quyền Giáo viên / Admin!');
}

// Khởi tạo Sql.js Database
let db;
const dbPath = process.env.RENDER ? path.join('/tmp', 'math_hoangyen.db') : path.join(__dirname, 'math_hoangyen.db');

function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

function parseResult(res) {
  if (!res || res.length === 0) return [];
  const columns = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  });
}

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }

  // Khởi tạo bảng dữ liệu
  db.run(`
    CREATE TABLE IF NOT EXISTS math_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      level TEXT NOT NULL,
      topic TEXT,
      description TEXT,
      pdf_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      time_spent INTEGER,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // TỰ ĐỘNG CẬP NHẬT KHO BÀI GIẢNG & TRẮC NGHIỆM MẪU NẾU CHƯA CÓ
  const res = db.exec('SELECT COUNT(*) as count FROM math_lessons');
  const count = res.length > 0 ? res[0].values[0][0] : 0;

  if (count === 0) {
    // Bài 1: Cấp 1
    db.run('INSERT INTO math_lessons (code, title, level, topic, description) VALUES (?, ?, ?, ?, ?)', 
      ['MATH-C1-01', 'Phép Nhân & Bảng Cửu Chương Nâng Cao', 'Cấp 1 (Tiểu học)', 'Số học', 'Phương pháp nhẩm nhanh các bảng cửu chương từ 2 đến 9 và ứng dụng toán đố.']);
    
    // Bài 2: Cấp 2
    db.run('INSERT INTO math_lessons (code, title, level, topic, description) VALUES (?, ?, ?, ?, ?)', 
      ['MATH-C2-01', 'Phương Trình Bậc Nhất 1 Ẩn & Ứng Dụng', 'Cấp 2 (THCS)', 'Đại số', 'Lý thuyết cơ bản, các dạng bài tập giải phương trình và bài toán lập phương trình.']);
    
    // Bài 3: Cấp 3
    db.run('INSERT INTO math_lessons (code, title, level, topic, description) VALUES (?, ?, ?, ?, ?)', 
      ['MATH-C3-01', 'Đạo Hàm & Ứng Dụng Khảo Sát Hàm Số', 'Cấp 3 (THPT)', 'Giải tích', 'Các quy tắc tính đạo hàm, ý nghĩa hình học và bài toán tiếp tuyến.']);

    // Tự động nạp Bài tập trắc nghiệm
    // Trắc nghiệm bài 1
    db.run(`INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES 
      (1, 'Kết quả của phép tính 7 x 8 là bao nhiêu?', '54', '56', '64', '48', 'B', '7 nhân 8 bằng 56 theo bảng cửu chương 7.')`);
    db.run(`INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES 
      (1, 'Một lớp học có 5 hàng ghế, mỗi hàng có 6 học sinh. Hỏi lớp có bao nhiêu học sinh?', '25 học sinh', '30 học sinh', '35 học sinh', '20 học sinh', 'B', 'Tổng số học sinh = 5 x 6 = 30 học sinh.')`);

    // Trắc nghiệm bài 2
    db.run(`INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES 
      (2, 'Nghiệm của phương trình 2x + 6 = 0 là:', 'x = 3', 'x = -3', 'x = 0', 'x = 6', 'B', '2x = -6 => x = -6 / 2 = -3.')`);
    db.run(`INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES 
      (2, 'Phương trình 0x = 5 có bao nhiêu nghiệm?', '1 nghiệm', 'Vô số nghiệm', 'Vô nghiệm', '2 nghiệm', 'C', 'Không có giá trị x nào nhân với 0 bằng 5 được.')`);

    // Trắc nghiệm bài 3
    db.run(`INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES 
      (3, 'Đạo hàm của hàm số y = x^3 là:', 'y\' = 3x', 'y\' = 3x^2', 'y\' = x^2', 'y\' = 3x^3', 'B', 'Áp dụng công thức (x^n)\' = n * x^(n-1).')`);

    saveDatabase();
  }
}

initDB();

// ----------------- ROUTES ----------------- //

app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Đăng Nhập - Math with HoangYen</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #e0f2fe; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: white; padding: 35px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); width: 100%; max-width: 380px; border-top: 5px solid #0284c7; box-sizing: border-box; }
        h2 { text-align: center; color: #0284c7; margin-top: 0; font-size: 24px; }
        .form-group { margin-bottom: 18px; }
        label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 13px; color: #334155; }
        input { width: 100%; padding: 11px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; }
        button { width: 100%; background: #0284c7; color: white; padding: 12px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 15px; transition: background 0.2s; }
        button:hover { background: #0369a1; }
        .info { background: #f0f9ff; padding: 12px; border-radius: 6px; font-size: 13px; color: #0369a1; margin-bottom: 20px; border: 1px solid #bae6fd; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>📐 Math with HoangYen</h2>
        <div class="info">
          <b>Hệ thống Đăng Nhập:</b><br>
          • 🎓 <b>Giáo viên:</b> admin / 123456<br>
          • ✏️ <b>Học sinh:</b> hocsinh / 123456
        </div>
        <form action="/login" method="POST">
          <div class="form-group">
            <label>Tên đăng nhập:</label>
            <input type="text" name="username" required placeholder="Nhập admin hoặc hocsinh">
          </div>
          <div class="form-group">
            <label>Mật khẩu:</label>
            <input type="password" name="password" required placeholder="••••••">
          </div>
          <button type="submit">Đăng Nhập Vào Hệ Thống</button>
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

// APIs
app.get('/api/lessons', requireLogin, (req, res) => {
  const level = req.query.level || '';
  let stmt;
  if (level) {
    stmt = db.exec('SELECT * FROM math_lessons WHERE level = ? ORDER BY id DESC', [level]);
  } else {
    stmt = db.exec('SELECT * FROM math_lessons ORDER BY id DESC');
  }
  res.json(parseResult(stmt));
});

app.post('/api/lessons', requireLogin, requireAdmin, upload.single('pdf'), (req, res) => {
  const { code, title, level, topic, description } = req.body;
  const pdfPath = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    db.run('INSERT INTO math_lessons (code, title, level, topic, description, pdf_path) VALUES (?, ?, ?, ?, ?, ?)', 
      [code, title, level, topic, description || '', pdfPath]);
    saveDatabase();
    res.redirect('/');
  } catch (err) {
    res.status(400).send('Lỗi: Mã bài học đã tồn tại! <a href="/">Quay lại</a>');
  }
});

app.delete('/api/lessons/:id', requireLogin, requireAdmin, (req, res) => {
  const result = parseResult(db.exec('SELECT pdf_path FROM math_lessons WHERE id = ?', [req.params.id]));
  if (result.length > 0 && result[0].pdf_path) {
    const fullPath = path.join(uploadDir, path.basename(result[0].pdf_path));
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }
  db.run('DELETE FROM math_lessons WHERE id = ?', [req.params.id]);
  db.run('DELETE FROM math_quizzes WHERE lesson_id = ?', [req.params.id]);
  saveDatabase();
  res.json({ success: true });
});

app.get('/api/lessons/:id/quizzes', requireLogin, (req, res) => {
  const quizzes = parseResult(db.exec('SELECT id, question, option_a, option_b, option_c, option_d, explanation FROM math_quizzes WHERE lesson_id = ?', [req.params.id]));
  res.json(quizzes);
});

app.post('/api/quizzes', requireLogin, requireAdmin, (req, res) => {
  const { lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation } = req.body;
  db.run(`
    INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation || '']);
  saveDatabase();
  res.redirect('/');
});

app.post('/api/submit-quiz', requireLogin, (req, res) => {
  const { lesson_id, answers, time_spent } = req.body;
  const quizzes = parseResult(db.exec('SELECT id, correct_option, explanation FROM math_quizzes WHERE lesson_id = ?', [lesson_id]));

  if (quizzes.length === 0) {
    return res.json({ score: 100, status: 'Đã hoàn thành lý thuyết' });
  }

  let correctCount = 0;
  const details = [];

  quizzes.forEach(q => {
    const userAns = answers ? answers[q.id] : null;
    const isCorrect = userAns === q.correct_option;
    if (isCorrect) correctCount++;

    details.push({
      quiz_id: q.id,
      userAns: userAns || 'Chưa chọn',
      correctAns: q.correct_option,
      isCorrect,
      explanation: q.explanation
    });
  });

  const score = Math.round((correctCount / quizzes.length) * 100);
  const status = score >= 80 ? 'XUẤT SẮC 🌟' : (score >= 50 ? 'ĐẠT 👍' : 'CẦN ÔN LẠI 📚');

  db.run('INSERT INTO math_results (username, lesson_id, score, status, time_spent) VALUES (?, ?, ?, ?, ?)', [
    req.session.user.username,
    lesson_id,
    score,
    status,
    time_spent || 0
  ]);
  saveDatabase();

  res.json({ score, status, correctCount, total: quizzes.length, details });
});

app.get('/api/export-results', requireLogin, (req, res) => {
  const results = parseResult(db.exec(`
    SELECT r.id, r.username, l.title as lesson_name, l.level, r.score, r.status, r.time_spent, r.completed_at 
    FROM math_results r 
    JOIN math_lessons l ON r.lesson_id = l.id
    ORDER BY r.id DESC
  `));

  const json2csvParser = new Parser({ fields: ['id', 'username', 'lesson_name', 'level', 'score', 'status', 'time_spent', 'completed_at'] });
  const csv = json2csvParser.parse(results);

  res.header('Content-Type', 'text/csv');
  res.attachment(`BangDiem_MathHoangYen_${Date.now()}.csv`);
  res.send(csv);
});

// MAIN DASHBOARD
app.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Hệ Thống Học Toán Math with HoangYen</title>
      <style>
        :root { --primary: #0284c7; --primary-hover: #0369a1; --bg: #f8fafc; }
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; background: var(--bg); color: #0f172a; }
        header { background: var(--primary); color: white; padding: 15px 25px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        header h2 { margin: 0; font-size: 22px; }
        .container { max-width: 1200px; margin: 25px auto; padding: 0 20px; display: grid; grid-template-columns: ${user.role === 'Admin' ? '340px 1fr' : '1fr'}; gap: 25px; }
        .card { background: white; padding: 22px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .filter-btn { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-weight: 600; margin-right: 8px; font-size: 13px; }
        .filter-btn.active { background: var(--primary); color: white; border-color: var(--primary); }
        .lesson-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; margin-top: 20px; }
        .lesson-card { background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid var(--primary); padding: 18px; border-radius: 8px; transition: transform 0.2s; }
        .lesson-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .lesson-card h4 { margin: 8px 0; color: #1e293b; }
        .lesson-card p { font-size: 13px; color: #64748b; margin-bottom: 12px; }
        button { background: var(--primary); color: white; border: none; padding: 9px 15px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; }
        button:hover { background: var(--primary-hover); }
        .btn-danger { background: #ef4444; }
        .btn-danger:hover { background: #dc2626; }
        iframe { width: 100%; height: 500px; border: 1px solid #cbd5e1; margin-top: 15px; border-radius: 8px; }
        .quiz-item { background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #e2e8f0; }
        .quiz-option { margin: 6px 0; display: block; font-size: 14px; cursor: pointer; }
      </style>
    </head>
    <body>
      <header>
        <h2>📐 Math with HoangYen - Nền Tảng Học Toán Online</h2>
        <div>👤 <b>${user.username}</b> (${user.role === 'Admin' ? 'Giáo Viên' : 'Học Sinh'}) | <a href="/logout" style="color:white; text-decoration:underline;">Đăng xuất</a></div>
      </header>

      <div class="container">
        ${user.role === 'Admin' ? `
        <div class="card">
          <h3 style="margin-top:0;">➕ Thêm Bài Học Mới</h3>
          <form action="/api/lessons" method="POST" enctype="multipart/form-data">
            <p><input type="text" name="code" placeholder="Mã bài (Ví dụ: MATH-C1-02)" required style="width:100%; padding:8px; box-sizing:border-box;"></p>
            <p><input type="text" name="title" placeholder="Tên bài học" required style="width:100%; padding:8px; box-sizing:border-box;"></p>
            <p>
              <select name="level" style="width:100%; padding:8px;">
                <option value="Cấp 1 (Tiểu học)">Cấp 1 (Tiểu học)</option>
                <option value="Cấp 2 (THCS)">Cấp 2 (THCS)</option>
                <option value="Cấp 3 (THPT)">Cấp 3 (THPT)</option>
              </select>
            </p>
            <p><input type="text" name="topic" placeholder="Chuyên đề (Đại số, Hình học...)" style="width:100%; padding:8px; box-sizing:border-box;"></p>
            <p><textarea name="description" placeholder="Mô tả tóm tắt nội dung bài học..." style="width:100%; height:60px; padding:8px; box-sizing:border-box;"></textarea></p>
            <p><label style="font-size:12px;"><b>Tải file PDF tài liệu/giáo án:</b></label><br><input type="file" name="pdf" accept="application/pdf"></p>
            <button type="submit" style="width:100%;">Tải Bài Học Lên System</button>
          </form>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;">
          <h3>📝 Thêm Câu Hỏi Trắc Nghiệm</h3>
          <form action="/api/quizzes" method="POST">
            <p><input type="number" name="lesson_id" placeholder="ID Bài học (Ví dụ: 1)" required style="width:100%; padding:8px; box-sizing:border-box;"></p>
            <p><input type="text" name="question" placeholder="Nội dung câu hỏi" required style="width:100%; padding:8px; box-sizing:border-box;"></p>
            <p><input type="text" name="option_a" placeholder="Đáp án A" required style="width:100%; padding:8px; box-sizing:border-box;"></p>
            <p><input type="text" name="option_b" placeholder="Đáp án B" required style="width:100%; padding:8px; box-sizing:border-box;"></p>
            <p><input type="text" name="option_c" placeholder="Đáp án C" required style="width:100%; padding:8px; box-sizing:border-box;"></p>
            <p><input type="text" name="option_d" placeholder="Đáp án D" required style="width:100%; padding:8px; box-sizing:border-box;"></p>
            <p>
              <select name="correct_option" style="width:100%; padding:8px;">
                <option value="A">Đáp án đúng: A</option>
                <option value="B">Đáp án đúng: B</option>
                <option value="C">Đáp án đúng: C</option>
                <option value="D">Đáp án đúng: D</option>
              </select>
            </p>
            <p><input type="text" name="explanation" placeholder="Lời giải chi tiết (nếu có)" style="width:100%; padding:8px; box-sizing:border-box;"></p>
            <button type="submit" style="width:100%; background:#16a34a;">Lưu Câu Hỏi</button>
          </form>
        </div>
        ` : ''}

        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0;">📚 Kho Bài Giảng & Tài Liệu</h3>
            <a href="/api/export-results"><button style="background:#0284c7;">📥 Xuất Bảng Điểm CSV</button></a>
          </div>

          <div style="margin-top: 15px;">
            <button class="filter-btn active" onclick="filterLevel('', this)">Tất Cả</button>
            <button class="filter-btn" onclick="filterLevel('Cấp 1 (Tiểu học)', this)">Cấp 1</button>
            <button class="filter-btn" onclick="filterLevel('Cấp 2 (THCS)', this)">Cấp 2</button>
            <button class="filter-btn" onclick="filterLevel('Cấp 3 (THPT)', this)">Cấp 3</button>
          </div>

          <div class="lesson-grid" id="lessonList"></div>

          <!-- KHO HỌC TẬP TƯƠNG TÁC -->
          <div id="studyArea" style="display:none; margin-top:25px; border-top:2px dashed #cbd5e1; padding-top:20px;">
            <h3 id="lessonTitle" style="color:var(--primary); margin-top:0;">📖 Đang Học:</h3>
            
            <div id="pdfContainer" style="display:none;">
              <h4>📄 Tài Liệu / Bài Giảng PDF:</h4>
              <iframe id="pdfViewer" src="about:blank"></iframe>
            </div>

            <div id="quizBox" style="margin-top:20px; background:#f0fdf4; padding:20px; border-radius:10px; border:1px solid #bbf7d0;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <h4 style="margin:0; color:#166534;">✏️ Bài Tập Trắc Nghiệm Tự Luyện</h4>
                <div id="timer" style="font-weight:bold; color:#dc2626;">⏱️ Thời gian: 00:00</div>
              </div>
              
              <form id="quizForm" style="margin-top:15px;"><div id="quizQuestions"></div></form>
              
              <button id="btnSubmitQuiz" onclick="submitQuiz()" style="margin-top:15px; background:#16a34a;">Nộp Bài Chấm Điểm</button>
              
              <div id="quizResult" style="margin-top:15px;"></div>
            </div>
          </div>
        </div>
      </div>

      <script>
        let currentLessonId = null;
        let selectedLevel = '';
        let timerInterval = null;
        let secondsSpent = 0;

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
          
          if(lessons.length === 0) {
            list.innerHTML = '<p style="color:#64748b;">Chưa có bài học nào ở cấp học này.</p>';
            return;
          }

          lessons.forEach(l => {
            list.innerHTML += \`
              <div class="lesson-card">
                <small style="color:var(--primary); font-weight:bold;">\${l.level} - ID: \${l.id}</small>
                <h4>\${l.title}</h4>
                <p>\${l.description || 'Chưa có mô tả'}</p>
                <button onclick="startStudy(\${l.id}, '\${l.title}', '\${l.pdf_path}')">Bắt Đầu Học</button>
                ${user.role === 'Admin' ? `<button class="btn-danger" onclick="deleteLesson(\${l.id})" style="margin-left:5px;">Xóa</button>` : ''}
              </div>
            \`;
          });
        }

        async function startStudy(id, title, pdf) {
          currentLessonId = id;
          secondsSpent = 0;
          clearInterval(timerInterval);
          
          document.getElementById('studyArea').style.display = 'block';
          document.getElementById('lessonTitle').innerText = '📖 ' + title;
          document.getElementById('quizResult').innerHTML = '';
          document.getElementById('btnSubmitQuiz').style.display = 'inline-block';

          // Hiển thị PDF nếu có
          const pdfContainer = document.getElementById('pdfContainer');
          if (pdf && pdf !== 'null') {
            pdfContainer.style.display = 'block';
            document.getElementById('pdfViewer').src = pdf;
          } else {
            pdfContainer.style.display = 'none';
          }

          // Chạy đồng hồ
          timerInterval = setInterval(() => {
            secondsSpent++;
            const mins = String(Math.floor(secondsSpent / 60)).padStart(2, '0');
            const secs = String(secondsSpent % 60).padStart(2, '0');
            document.getElementById('timer').innerText = \`⏱️ Thời gian: \${mins}:\${secs}\`;
          }, 1000);

          // Tải danh sách trắc nghiệm
          const res = await fetch('/api/lessons/' + id + '/quizzes');
          const quizzes = await res.json();
          const qBox = document.getElementById('quizQuestions');
          qBox.innerHTML = '';

          if(quizzes.length === 0) {
            qBox.innerHTML = '<p style="color:#64748b;">Bài học này chưa có câu hỏi trắc nghiệm.</p>';
            document.getElementById('btnSubmitQuiz').style.display = 'none';
            return;
          }

          quizzes.forEach((q, i) => {
            qBox.innerHTML += \`
              <div class="quiz-item">
                <p style="font-weight:bold; margin-top:0;">Câu \${i+1}: \${q.question}</p>
                <label class="quiz-option"><input type="radio" name="quiz_\${q.id}" value="A"> A. \${q.option_a}</label>
                <label class="quiz-option"><input type="radio" name="quiz_\${q.id}" value="B"> B. \${q.option_b}</label>
                <label class="quiz-option"><input type="radio" name="quiz_\${q.id}" value="C"> C. \${q.option_c}</label>
                <label class="quiz-option"><input type="radio" name="quiz_\${q.id}" value="D"> D. \${q.option_d}</label>
              </div>
            \`;
          });
        }

        async function submitQuiz() {
          if (!currentLessonId) return;
          clearInterval(timerInterval);

          const form = document.getElementById('quizForm');
          const formData = new FormData(form);
          const answers = {};
          for (let [k, v] of formData.entries()) {
            if (k.startsWith('quiz_')) answers[k.replace('quiz_', '')] = v;
          }

          const res = await fetch('/api/submit-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lesson_id: currentLessonId, answers, time_spent: secondsSpent })
          });

          const resData = await res.json();
          
          let detailHtml = '';
          if(resData.details) {
            detailHtml = '<div style="margin-top:10px; font-size:13px;">';
            resData.details.forEach((d, idx) => {
              detailHtml += \`<p style="color:\${d.isCorrect ? '#16a34a' : '#dc2626'}; margin:4px 0;">
                <b>Câu \${idx+1}:</b> \${d.isCorrect ? 'Đúng ✔️' : 'Sai ❌'} (Bạn chọn: \${d.userAns} | Đáp án đúng: \${d.correctAns})
                \${d.explanation ? '<br><i>💡 Lời giải: ' + d.explanation + '</i>' : ''}
              </p>\`;
            });
            detailHtml += '</div>';
          }

          document.getElementById('quizResult').innerHTML = \`
            <div style="background:white; padding:15px; border-radius:8px; border:1px solid #cbd5e1;">
              <h4 style="margin-top:0; color:var(--primary);">🎯 KẾT QUẢ BÀI LÀM</h4>
              <p><b>Điểm số:</b> \${resData.score}/100 | <b>Đánh giá:</b> \${resData.status}</p>
              <p><b>Số câu đúng:</b> \${resData.correctCount}/\${resData.total}</p>
              \${detailHtml}
            </div>
          \`;
        }

        async function deleteLesson(id) {
          if(confirm('Bạn có chắc chắn muốn xóa bài học này?')) {
            await fetch('/api/lessons/' + id, { method: 'DELETE' });
            loadLessons();
          }
        }

        loadLessons();
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server Math với Hoàng Yến đang chạy tại cổng: ${PORT}`);
});
