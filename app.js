const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { Parser } = require('json2csv');

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình thư mục upload (Tương thích với bộ nhớ tạm Render /tmp)
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
  secret: 'math-hoangyen-hierarchy-2026',
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

// Khởi tạo Database SQLite
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
        level TEXT NOT NULL,       -- Ví dụ: Cấp 1, Cấp 2, Cấp 3
        grade_class TEXT NOT NULL, -- Ví dụ: Lớp 1 ... Lớp 12
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
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Dữ liệu khởi tạo mẫu nếu cơ sở dữ liệu trống
    const res = db.exec('SELECT COUNT(*) as count FROM math_lessons');
    if (res.length === 0 || res[0].values[0][0] === 0) {
      db.run('INSERT INTO math_lessons (code, title, level, grade_class, topic, description) VALUES (?, ?, ?, ?, ?, ?)', 
        ['MATH-L1-01', 'Phép Cộng Trong Phạm Vi 10', 'Cấp 1 (Tiểu học)', 'Lớp 1', 'Số Học', 'Các bài toán cộng đếm dành cho học sinh Lớp 1.']);

      db.run('INSERT INTO math_lessons (code, title, level, grade_class, topic, description) VALUES (?, ?, ?, ?, ?, ?)', 
        ['MATH-L6-01', 'Tập Hợp & Phần Tử Của Tập Hợp', 'Cấp 2 (THCS)', 'Lớp 6', 'Đại Số', 'Chuyên đề mở đầu chương trình Toán Lớp 6.']);

      db.run('INSERT INTO math_lessons (code, title, level, grade_class, topic, description) VALUES (?, ?, ?, ?, ?, ?)', 
        ['MATH-L12-01', 'Tính Đơn Điệu Của Hàm Số', 'Cấp 3 (THPT)', 'Lớp 12', 'Giải Tích', 'Chuyên đề trọng tâm ôn thi Tốt nghiệp THPT Lớp 12.']);

      db.run(`INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES 
        (1, 'Kết quả của phép tính 3 + 5 là:', '7', '8', '9', '6', 'B', '3 cộng 5 bằng 8.')`);

      saveDatabase();
    }
    console.log('✅ Cơ sở dữ liệu và Danh mục Lớp học đã khởi tạo xong!');
  } catch (err) {
    console.error('❌ Lỗi khởi tạo DB:', err);
  }
}

// ----------------- CÁC API HỆ THỐNG ----------------- //

app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <title>Đăng Nhập - Math HoangYen</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #e0f2fe; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); width: 100%; max-width: 380px; border-top: 5px solid #0284c7; }
        h2 { text-align: center; color: #0284c7; margin-top: 0; }
        .form-group { margin-bottom: 15px; }
        label { display: block; font-weight: 600; margin-bottom: 5px; font-size: 13px; color: #334155; }
        input { width: 100%; padding: 10px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 6px; }
        button { width: 100%; background: #0284c7; color: white; padding: 11px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
        .info { background: #f0f9ff; padding: 12px; border-radius: 6px; font-size: 13px; color: #0369a1; margin-bottom: 18px; border-left: 4px solid #0284c7; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>📐 Math HoangYen</h2>
        <div class="info">
          🔑 <b>Tài khoản hệ thống:</b><br>
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
    res.send('<script>alert("Sai tên đăng nhập hoặc mật khẩu!"); window.location.href="/login";</script>');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// API Lấy danh sách Bài học lọc theo Cấp hoặc theo Lớp
app.get('/api/lessons', requireLogin, (req, res) => {
  if (!db) return res.json([]);
  const { level, grade_class } = req.query;
  let sql = 'SELECT * FROM math_lessons WHERE 1=1';
  const params = [];

  if (level) {
    sql += ' AND level = ?';
    params.push(level);
  }
  if (grade_class) {
    sql += ' AND grade_class = ?';
    params.push(grade_class);
  }

  sql += ' ORDER BY id DESC';
  res.json(parseResult(db.exec(sql, params)));
});

// API Thêm bài học mới
app.post('/api/lessons', requireLogin, requireAdmin, upload.single('pdf'), (req, res) => {
  const { code, title, level, grade_class, topic, description } = req.body;
  const pdfPath = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    db.run('INSERT INTO math_lessons (code, title, level, grade_class, topic, description, pdf_path) VALUES (?, ?, ?, ?, ?, ?, ?)', 
      [code, title, level, grade_class, topic, description || '', pdfPath]);
    saveDatabase();
    res.redirect('/#lessons');
  } catch (err) {
    res.status(400).send('Lỗi: Mã Bài Học này đã tồn tại! <a href="/">Quay lại</a>');
  }
});

// API Xóa bài học
app.delete('/api/lessons/:id', requireLogin, requireAdmin, (req, res) => {
  db.run('DELETE FROM math_lessons WHERE id = ?', [req.params.id]);
  db.run('DELETE FROM math_quizzes WHERE lesson_id = ?', [req.params.id]);
  saveDatabase();
  res.json({ success: true });
});

// API Quản lý Bài tập Trắc nghiệm
app.get('/api/quizzes', requireLogin, (req, res) => {
  if (!db) return res.json([]);
  const lesson_id = req.query.lesson_id;
  const stmt = lesson_id ? db.exec('SELECT * FROM math_quizzes WHERE lesson_id = ?', [lesson_id]) : db.exec('SELECT q.*, l.title as lesson_title FROM math_quizzes q LEFT JOIN math_lessons l ON q.lesson_id = l.id ORDER BY q.id DESC');
  res.json(parseResult(stmt));
});

app.post('/api/quizzes', requireLogin, requireAdmin, (req, res) => {
  const { lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation } = req.body;
  db.run(`
    INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation || '']);
  saveDatabase();
  res.redirect('/#exercises');
});

app.post('/api/submit-quiz', requireLogin, (req, res) => {
  const { lesson_id, answers } = req.body;
  const quizzes = parseResult(db.exec('SELECT id, correct_option FROM math_quizzes WHERE lesson_id = ?', [lesson_id]));

  if (quizzes.length === 0) return res.json({ score: 100, status: 'Hoàn thành' });

  let correctCount = 0;
  quizzes.forEach(q => {
    if (answers && answers[q.id] === q.correct_option) correctCount++;
  });

  const score = Math.round((correctCount / quizzes.length) * 100);
  const status = score >= 80 ? 'XUẤT SẮC 🌟' : (score >= 50 ? 'ĐẠT 👍' : 'CẦN ÔN LẠI 📚');

  db.run('INSERT INTO math_results (username, lesson_id, score, status) VALUES (?, ?, ?, ?)', [
    req.session.user.username, lesson_id, score, status
  ]);
  saveDatabase();

  res.json({ score, status, correctCount, total: quizzes.length });
});

// API Xem Bảng điểm
app.get('/api/results', requireLogin, (req, res) => {
  if (!db) return res.json([]);
  let sql = `
    SELECT r.id, r.username, l.title as lesson_name, l.grade_class, r.score, r.status, r.completed_at 
    FROM math_results r 
    LEFT JOIN math_lessons l ON r.lesson_id = l.id
  `;
  if (req.session.user.role !== 'Admin') {
    sql += ` WHERE r.username = '${req.session.user.username}'`;
  }
  sql += ' ORDER BY r.id DESC';
  res.json(parseResult(db.exec(sql)));
});

// ----------------- GIAO DIỆN HỆ THỐNG PHÂN MỤC VÀ CẤP LỚP ----------------- //

app.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Hệ Thống Toán Học Phân Loại Theo Lớp</title>
      <style>
        :root { --primary: #0284c7; --primary-dark: #0369a1; --bg: #f8fafc; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: var(--bg); color: #0f172a; }
        
        header { background: var(--primary); color: white; padding: 0 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .logo { font-size: 20px; font-weight: bold; }
        .user-box { font-size: 14px; }
        .user-box a { color: #e0f2fe; text-decoration: none; font-weight: bold; margin-left: 10px; }

        .nav-tabs { background: white; border-bottom: 1px solid #e2e8f0; display: flex; padding: 0 20px; gap: 10px; }
        .tab-btn { padding: 14px 20px; border: none; background: none; font-size: 15px; font-weight: 600; color: #64748b; cursor: pointer; border-bottom: 3px solid transparent; }
        .tab-btn:hover { color: var(--primary); }
        .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }

        .container { max-width: 1200px; margin: 25px auto; padding: 0 20px; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }

        .card { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .btn { background: var(--primary); color: white; border: none; padding: 9px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; }
        .btn:hover { background: var(--primary-dark); }
        .btn-danger { background: #dc2626; }
        
        input, select, textarea { width: 100%; padding: 9px; margin-top: 5px; margin-bottom: 12px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
        
        .grid-2 { display: grid; grid-template-columns: 320px 1fr; gap: 20px; }
        .lesson-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
        .lesson-card { background: white; border: 1px solid #e2e8f0; border-top: 4px solid var(--primary); padding: 18px; border-radius: 8px; }

        /* Style danh mục Lớp học */
        .filter-group { margin-bottom: 15px; }
        .grade-badge { display: inline-block; padding: 6px 12px; background: #e0f2fe; color: #0369a1; border-radius: 20px; font-size: 13px; font-weight: bold; margin-right: 5px; margin-bottom: 8px; cursor: pointer; border: 1px solid #bae6fd; }
        .grade-badge:hover, .grade-badge.active { background: var(--primary); color: white; }

        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #f1f5f9; color: #475569; }
        iframe { width: 100%; height: 500px; border: 1px solid #cbd5e1; border-radius: 6px; margin-top: 15px; }
      </style>
    </head>
    <body>

      <header>
        <div class="logo">📐 Math HoangYen - Hệ Thống Bài Giảng Theo Lớp</div>
        <div class="user-box">
          👤 <b>${user.username}</b> (${user.role}) | 
          <a href="/logout">Đăng xuất</a>
        </div>
      </header>

      <!-- TABS CHÍNH -->
      <div class="nav-tabs">
        <button class="tab-btn active" onclick="switchTab('lessons', this)">📚 Mục 1: Thư Viện Tài Liệu Theo Lớp</button>
        <button class="tab-btn" onclick="switchTab('exercises', this)">📝 Mục 2: Ngân Hàng Bài Tập Trắc Nghiệm</button>
        <button class="tab-btn" onclick="switchTab('results', this)">📊 Mục 3: Kết Quả & Bảng Điểm</button>
      </div>

      <div class="container">

        <!-- ================= MỤC 1: TÀI LIỆU CÁC LỚP ================= -->
        <div id="tab-lessons" class="tab-content active">
          <div class="${user.role === 'Admin' ? 'grid-2' : ''}">
            
            ${user.role === 'Admin' ? `
            <div class="card">
              <h3>📂 Thêm Bài Học Mới</h3>
              <form action="/api/lessons" method="POST" enctype="multipart/form-data">
                <label>Mã bài học:</label>
                <input type="text" name="code" placeholder="VD: MATH-L6-02" required>
                
                <label>Tên bài học:</label>
                <input type="text" name="title" placeholder="VD: Phép Chia Hết & Phép Chia Có Dư" required>
                
                <label>Khối Cấp Học:</label>
                <select name="level" id="formLevel" onchange="updateGradeDropdown(this.value)">
                  <option value="Cấp 1 (Tiểu học)">Cấp 1 (Tiểu học)</option>
                  <option value="Cấp 2 (THCS)" selected>Cấp 2 (THCS)</option>
                  <option value="Cấp 3 (THPT)">Cấp 3 (THPT)</option>
                </select>

                <label>Chọn Lớp Học Cụ Thể:</label>
                <select name="grade_class" id="formGrade">
                  <!-- JS sẽ điền danh sách lớp dựa trên Cấp học -->
                </select>

                <label>Chuyên đề Toán:</label>
                <input type="text" name="topic" placeholder="VD: Đại số, Hình học...">

                <label>Tệp PDF Bài Giảng:</label>
                <input type="file" name="pdf" accept="application/pdf">

                <label>Mô tả ngắn:</label>
                <textarea name="description" rows="2"></textarea>

                <button type="submit" class="btn" style="width: 100%;">Tải Bài Học Lên</button>
              </form>
            </div>
            ` : ''}

            <div>
              <div class="card">
                <h3>🏷️ Phân Loại Danh Mục Theo Lớp Học</h3>
                
                <div class="filter-group">
                  <span class="grade-badge active" onclick="filterByGrade('', this)">Tất Cả Lớp</span>
                </div>

                <div class="filter-group">
                  <b>• Cấp 1 (Tiểu Học):</b><br>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 1', this)">Lớp 1</span>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 2', this)">Lớp 2</span>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 3', this)">Lớp 3</span>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 4', this)">Lớp 4</span>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 5', this)">Lớp 5</span>
                </div>

                <div class="filter-group">
                  <b>• Cấp 2 (THCS):</b><br>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 6', this)">Lớp 6</span>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 7', this)">Lớp 7</span>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 8', this)">Lớp 8</span>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 9', this)">Lớp 9</span>
                </div>

                <div class="filter-group">
                  <b>• Cấp 3 (THPT):</b><br>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 10', this)">Lớp 10</span>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 11', this)">Lớp 11</span>
                  <span class="grade-badge" onclick="filterByGrade('Lớp 12', this)">Lớp 12</span>
                </div>

                <hr style="border:none; border-top: 1px solid #e2e8f0; margin: 15px 0;">
                
                <div class="lesson-grid" id="lessonGrid"></div>
              </div>

              <!-- Trình xem PDF -->
              <div class="card" id="pdfViewerCard" style="display:none;">
                <h3 id="pdfTitle">Nội dung bài học</h3>
                <iframe id="pdfFrame" src="about:blank"></iframe>
              </div>
            </div>

          </div>
        </div>

        <!-- ================= MỤC 2: BÀI TẬP TRẮC NGHIỆM ================= -->
        <div id="tab-exercises" class="tab-content">
          <div class="${user.role === 'Admin' ? 'grid-2' : ''}">
            ${user.role === 'Admin' ? `
            <div class="card">
              <h3>➕ Tạo Câu Hỏi Mới</h3>
              <form action="/api/quizzes" method="POST">
                <label>Thuộc Bài Học Của Lớp:</label>
                <select name="lesson_id" id="quizLessonSelect" required></select>

                <label>Câu hỏi:</label>
                <textarea name="question" rows="3" required placeholder="Nhập nội dung câu hỏi..."></textarea>

                <label>Đáp án A:</label> <input type="text" name="option_a" required>
                <label>Đáp án B:</label> <input type="text" name="option_b" required>
                <label>Đáp án C:</label> <input type="text" name="option_c" required>
                <label>Đáp án D:</label> <input type="text" name="option_d" required>

                <label>Đáp Án Đúng:</label>
                <select name="correct_option">
                  <option value="A">Khung A</option>
                  <option value="B">Khung B</option>
                  <option value="C">Khung C</option>
                  <option value="D">Khung D</option>
                </select>

                <label>Lời giải chi tiết:</label>
                <textarea name="explanation" rows="2"></textarea>

                <button type="submit" class="btn" style="width:100%; background:#16a34a;">Lưu Câu Hỏi</button>
              </form>
            </div>
            ` : ''}

            <div>
              <div class="card">
                <h3>📝 Danh Sách Bài Tập Theo Lớp</h3>
                <label>Lựa Chọn Bài Học Để Luyện Tập:</label>
                <select id="doExerciseSelect" onchange="loadQuizForStudent(this.value)">
                  <option value="">-- Chọn bài học --</option>
                </select>

                <div id="quizDoingArea" style="margin-top: 20px; display:none;">
                  <form id="studentQuizForm"></form>
                  <button class="btn" onclick="submitStudentQuiz()" style="margin-top: 15px; background:#16a34a;">Nộp Bài Làm</button>
                  <div id="quizResultNotify" style="margin-top:15px; font-weight:bold; font-size:16px;"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ================= MỤC 3: BẢNG ĐIỂM ================= -->
        <div id="tab-results" class="tab-content">
          <div class="card">
            <h3>📊 Bảng Điểm Luyện Tập Bài Tập</h3>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Học Sinh</th>
                  <th>Bài Học</th>
                  <th>Lớp</th>
                  <th>Điểm Số</th>
                  <th>Đánh Giá</th>
                  <th>Thời Gian</th>
                </tr>
              </thead>
              <tbody id="resultsTableBody"></tbody>
            </table>
          </div>
        </div>

      </div>

      <script>
        const userRole = "${user.role}";

        // Tự động điều chỉnh dropdown chọn lớp học theo cấp học
        function updateGradeDropdown(level) {
          const select = document.getElementById('formGrade');
          if(!select) return;
          select.innerHTML = '';
          
          let grades = [];
          if(level === 'Cấp 1 (Tiểu học)') grades = ['Lớp 1', 'Lớp 2', 'Lớp 3', 'Lớp 4', 'Lớp 5'];
          else if(level === 'Cấp 2 (THCS)') grades = ['Lớp 6', 'Lớp 7', 'Lớp 8', 'Lớp 9'];
          else grades = ['Lớp 10', 'Lớp 11', 'Lớp 12'];

          grades.forEach(g => {
            select.innerHTML += \`<option value="\${g}">\${g}</option>\`;
          });
        }

        // Chuyển Tab
        function switchTab(tabName, btn) {
          document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          
          document.getElementById('tab-' + tabName).classList.add('active');
          btn.classList.add('active');

          if(tabName === 'lessons') loadLessons();
          if(tabName === 'exercises') loadQuizOptions();
          if(tabName === 'results') loadResults();
        }

        // 1. Tải danh sách Bài giảng theo Lớp
        async function loadLessons(grade = '') {
          const res = await fetch('/api/lessons?grade_class=' + encodeURIComponent(grade));
          const lessons = await res.json();
          const grid = document.getElementById('lessonGrid');
          grid.innerHTML = '';

          if(lessons.length === 0) {
            grid.innerHTML = '<p style="color:#64748b;">Chưa có tài liệu/bài giảng nào cho lựa chọn này.</p>';
            return;
          }

          lessons.forEach(l => {
            grid.innerHTML += \`
              <div class="lesson-card">
                <small style="color:var(--primary); font-weight:bold;">\${l.grade_class} - \${l.level}</small>
                <h4 style="margin: 8px 0;">\${l.title}</h4>
                <p style="font-size:13px; color:#64748b;">Chuyên đề: <b>\${l.topic || 'Chung'}</b></p>
                <p style="font-size:13px; color:#64748b;">\${l.description || 'Chưa có mô tả'}</p>
                <button class="btn" onclick="viewPdf('\${l.title}', '\${l.pdf_path}')">Xem Tài Liệu PDF</button>
                \${userRole === 'Admin' ? \`<button class="btn btn-danger" onclick="deleteLesson(\${l.id})" style="margin-left:5px;">Xóa</button>\` : ''}
              </div>
            \`;
          });
        }

        function filterByGrade(grade, element) {
          document.querySelectorAll('.grade-badge').forEach(b => b.classList.remove('active'));
          element.classList.add('active');
          loadLessons(grade);
        }

        function viewPdf(title, path) {
          if(!path) return alert('Bài học này chưa được đính kèm file PDF!');
          document.getElementById('pdfViewerCard').style.display = 'block';
          document.getElementById('pdfTitle').innerText = '📖 ' + title;
          document.getElementById('pdfFrame').src = path;
        }

        async function deleteLesson(id) {
          if(confirm('Bạn có chắc chắn muốn xóa bài học này?')) {
            await fetch('/api/lessons/' + id, { method: 'DELETE' });
            loadLessons();
          }
        }

        // 2. Bài tập
        async function loadQuizOptions() {
          const res = await fetch('/api/lessons');
          const lessons = await res.json();
          
          const selAdmin = document.getElementById('quizLessonSelect');
          const selStudent = document.getElementById('doExerciseSelect');
          
          let options = '<option value="">-- Chọn Bài Học --</option>';
          lessons.forEach(l => { options += \`<option value="\${l.id}">[\${l.grade_class}] \${l.title}</option>\`; });
          
          if(selAdmin) selAdmin.innerHTML = options;
          if(selStudent) selStudent.innerHTML = options;
        }

        async function loadQuizForStudent(lessonId) {
          if(!lessonId) return;
          const res = await fetch('/api/quizzes?lesson_id=' + lessonId);
          const quizzes = await res.json();
          
          const area = document.getElementById('quizDoingArea');
          const form = document.getElementById('studentQuizForm');
          
          if(quizzes.length === 0) {
            area.style.display = 'none';
            alert('Bài học này chưa có câu hỏi trắc nghiệm!');
            return;
          }

          area.style.display = 'block';
          form.innerHTML = '';
          
          quizzes.forEach((q, idx) => {
            form.innerHTML += \`
              <div style="margin-bottom: 15px; padding: 10px; background:#f8fafc; border-radius:6px;">
                <p><b>Câu \${idx + 1}: \${q.question}</b></p>
                <label><input type="radio" name="q_\${q.id}" value="A"> A. \${q.option_a}</label><br>
                <label><input type="radio" name="q_\${q.id}" value="B"> B. \${q.option_b}</label><br>
                <label><input type="radio" name="q_\${q.id}" value="C"> C. \${q.option_c}</label><br>
                <label><input type="radio" name="q_\${q.id}" value="D"> D. \${q.option_d}</label>
              </div>
            \`;
          });
        }

        async function submitStudentQuiz() {
          const lessonId = document.getElementById('doExerciseSelect').value;
          const form = document.getElementById('studentQuizForm');
          const formData = new FormData(form);
          const answers = {};

          for (let [k, v] of formData.entries()) {
            if (k.startsWith('q_')) answers[k.replace('q_', '')] = v;
          }

          const res = await fetch('/api/submit-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lesson_id: lessonId, answers })
          });

          const result = await res.json();
          document.getElementById('quizResultNotify').innerHTML = 
            \`Kết quả: <span style="color:var(--primary)">\${result.score}/100 điểm</span> - Đánh giá: <b>\${result.status}</b> (\${result.correctCount}/\${result.total} câu)\`;
        }

        // 3. Kết quả
        async function loadResults() {
          const res = await fetch('/api/results');
          const data = await res.json();
          const tbody = document.getElementById('resultsTableBody');
          tbody.innerHTML = '';

          data.forEach((r, i) => {
            tbody.innerHTML += \`
              <tr>
                <td>\${i + 1}</td>
                <td><b>\${r.username}</b></td>
                <td>\${r.lesson_name || 'N/A'}</td>
                <td><span style="color:var(--primary); font-weight:bold;">\${r.grade_class || 'N/A'}</span></td>
                <td><b>\${r.score} điểm</b></td>
                <td>\${r.status}</td>
                <td>\${new Date(r.completed_at).toLocaleString('vi-VN')}</td>
              </tr>
            \`;
          });
        }

        // Khởi tạo
        if(document.getElementById('formLevel')) {
          updateGradeDropdown(document.getElementById('formLevel').value);
        }
        loadLessons();
      </script>
    </body>
    </html>
  `);
});

// Khởi chạy Máy chủ
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server Math HoangYen đang chạy thành công tại cổng: ${PORT}`);
  });
});
