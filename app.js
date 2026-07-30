const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// Khởi tạo Gemini AI Client
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey: apiKey });

// Cấu hình thư mục upload (Tương thích bộ nhớ tạm /tmp trên Render)
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

let db;
const dbPath = process.env.RENDER ? path.join('/tmp', 'math_hoangyen.db') : path.join(__dirname, 'math_hoangyen.db');

function saveDatabase() {
  if (db) {
    try {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
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

// Hàm xử lý và bóc tách dữ liệu JSON an toàn từ AI
function cleanAndParseJSON(text) {
  if (!text) throw new Error("Phản hồi từ AI rỗng");
  // Loại bỏ các ký tự bọc markdown nếu có
  let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Nếu vẫn lỗi, thử tìm mảng [...] bằng Regex
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("Không thể chuyển đổi phản hồi từ Gemini AI thành định dạng JSON bài tập hợp lệ.");
  }
}

async function initDB() {
  try {
    const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    const SQL = await initSqlJs({
      locateFile: file => fs.existsSync(wasmPath) ? wasmPath : `[https://sql.js.org/dist/$](https://sql.js.org/dist/$){file}`
    });

    db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();

    db.run(`
      CREATE TABLE IF NOT EXISTS math_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        level TEXT NOT NULL,
        grade_class TEXT NOT NULL,
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

    saveDatabase();
    console.log('✅ Cơ sở dữ liệu SQLite đã sẵn sàng!');
  } catch (err) {
    console.error('❌ Lỗi khởi tạo DB:', err);
  }
}

// ----------------- ROUTES ----------------- //

app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <title>Đăng Nhập - Math HoangYen</title>
      <style>
        body { font-family: sans-serif; background: #e0f2fe; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: white; padding: 30px; border-radius: 12px; width: 100%; max-width: 380px; border-top: 5px solid #0284c7; }
        h2 { text-align: center; color: #0284c7; margin-top:0; }
        input { width: 100%; padding: 10px; margin: 8px 0 15px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; background: #0284c7; color: white; padding: 11px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>📐 Đăng Nhập Hệ Thống</h2>
        <form action="/login" method="POST">
          <label>Tên đăng nhập:</label>
          <input type="text" name="username" required placeholder="admin hoặc hocsinh">
          <label>Mật khẩu:</label>
          <input type="password" name="password" required placeholder="123456">
          <button type="submit">Vào Hệ Thống</button>
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

// API Lấy danh sách Bài học
app.get('/api/lessons', requireLogin, (req, res) => {
  if (!db) return res.json([]);
  const { grade_class } = req.query;
  let sql = 'SELECT * FROM math_lessons WHERE 1=1';
  const params = [];
  if (grade_class) {
    sql += ' AND grade_class = ?';
    params.push(grade_class);
  }
  sql += ' ORDER BY id DESC';
  res.json(parseResult(db.exec(sql, params)));
});

// API Thêm Bài học mới + Tự động sinh bài tập bằng Gemini AI
app.post('/api/lessons', requireLogin, requireAdmin, upload.single('pdf'), async (req, res) => {
  const { code, title, level, grade_class, topic, description, auto_gen_quiz } = req.body;
  const pdfPath = req.file ? `/uploads/${req.file.filename}` : null;
  let quizCountAdded = 0;
  
  try {
    db.run('INSERT INTO math_lessons (code, title, level, grade_class, topic, description, pdf_path) VALUES (?, ?, ?, ?, ?, ?, ?)', 
      [code, title, level, grade_class, topic, description || '', pdfPath]);
    
    const lastIdRes = db.exec('SELECT last_insert_rowid() as id');
    const lessonId = lastIdRes[0].values[0][0];

    // XỬ LÝ SINH BÀI TẬP BẰNG AI
    if (auto_gen_quiz === 'on') {
      let contextText = "";

      if (req.file) {
        try {
          const fullPath = path.join(uploadDir, req.file.filename);
          const dataBuffer = fs.readFileSync(fullPath);
          const pdfData = await pdfParse(dataBuffer);
          contextText = (pdfData.text || "").trim().slice(0, 3500);
        } catch (pdfErr) {
          console.warn("⚠️ Không thể đọc file PDF, chuyển sang chế độ tạo theo tiêu đề bài học:", pdfErr.message);
        }
      }

      let promptContent = "";
      if (contextText.length > 50) {
        promptContent = `Dựa vào nội dung tài liệu Toán học sau đây:\n---\n${contextText}\n---`;
      } else {
        promptContent = `Tạo bài tập Toán học chuẩn chương trình cho chủ đề: "${title}" (Chuyên đề: ${topic || 'Đại số/Hình học'}).`;
      }

      const prompt = `${promptContent}

Hãy tạo 4 câu hỏi trắc nghiệm khách quan toán học phù hợp cho học sinh trình độ ${grade_class}.

YÊU CẦU ĐỊNH DẠNG:
Trả về duy nhất một mảng JSON (JSON Array), KHÔNG chứa ký tự bọc Markdown (không dùng \`\`\`json), KHÔNG chứa bất kỳ lời giải thích nào khác ngoài JSON.

Cấu trúc JSON bắt buộc:
[
  {
    "question": "Nội dung câu hỏi Toán?",
    "option_a": "Phương án A",
    "option_b": "Phương án B",
    "option_c": "Phương án C",
    "option_d": "Phương án D",
    "correct_option": "A",
    "explanation": "Lời giải chi tiết ngắn gọn"
  }
]`;

      if (!process.env.GEMINI_API_KEY) {
        console.error("❌ CẢNH BÁO: Chưa cấu hình GEMINI_API_KEY trong Environment Variables!");
      } else {
        let aiResponseText = "";
        
        // Thử gọi model chính gemini-2.5-flash, nếu lỗi tự động fallback sang gemini-1.5-flash
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
          });
          aiResponseText = response.text;
        } catch (modelErr) {
          console.warn("⚠️ Fallback sang gemini-1.5-flash do lỗi:", modelErr.message);
          const fallbackResponse = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: prompt,
          });
          aiResponseText = fallbackResponse.text;
        }

        const quizList = cleanAndParseJSON(aiResponseText);

        if (Array.isArray(quizList)) {
          quizList.forEach(q => {
            db.run(`
              INSERT INTO math_quizzes (lesson_id, question, option_a, option_b, option_c, option_d, correct_option, explanation)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [lessonId, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option || 'A', q.explanation || '']);
            quizCountAdded++;
          });
        }
      }
    }

    saveDatabase();
    res.send(`
      <script>
        alert("✅ Thêm bài học thành công! AI đã tạo ${quizCountAdded} câu hỏi trắc nghiệm.");
        window.location.href = "/#lessons";
      </script>
    `);
  } catch (err) {
    console.error('❌ Lỗi xử lý bài học/AI:', err);
    res.status(500).send(`
      <div style="font-family:sans-serif; padding:20px; text-align:center;">
        <h3 style="color:#dc2626;">❌ Lỗi trong quá trình tạo bài học/bài tập!</h3>
        <p>Chi tiết: ${err.message}</p>
        <a href="/" style="color:#0284c7; font-weight:bold;">Quay lại trang chủ</a>
      </div>
    `);
  }
});

// API Xóa bài học
app.delete('/api/lessons/:id', requireLogin, requireAdmin, (req, res) => {
  db.run('DELETE FROM math_lessons WHERE id = ?', [req.params.id]);
  db.run('DELETE FROM math_quizzes WHERE lesson_id = ?', [req.params.id]);
  saveDatabase();
  res.json({ success: true });
});

// API Lấy danh sách bài tập trắc nghiệm
app.get('/api/quizzes', requireLogin, (req, res) => {
  if (!db) return res.json([]);
  const lesson_id = req.query.lesson_id;
  const stmt = lesson_id ? db.exec('SELECT * FROM math_quizzes WHERE lesson_id = ?', [lesson_id]) : db.exec('SELECT q.*, l.title as lesson_title FROM math_quizzes q LEFT JOIN math_lessons l ON q.lesson_id = l.id ORDER BY q.id DESC');
  res.json(parseResult(stmt));
});

// API Nộp bài làm trắc nghiệm
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

// API Lấy kết quả làm bài
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

// Giao diện chính
app.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Math HoangYen - Hệ Thống Bài Giảng & Bài Tập AI</title>
      <style>
        :root { --primary: #0284c7; --bg: #f8fafc; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: var(--bg); color: #0f172a; }
        header { background: var(--primary); color: white; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; }
        .nav-tabs { background: white; border-bottom: 1px solid #e2e8f0; display: flex; padding: 0 20px; gap: 10px; }
        .tab-btn { padding: 14px 20px; border: none; background: none; font-size: 15px; font-weight: 600; color: #64748b; cursor: pointer; border-bottom: 3px solid transparent; }
        .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }
        .container { max-width: 1200px; margin: 25px auto; padding: 0 20px; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .card { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .btn { background: var(--primary); color: white; border: none; padding: 9px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; }
        .btn-danger { background: #dc2626; }
        input, select, textarea { width: 100%; padding: 9px; margin-top: 5px; margin-bottom: 12px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
        .grid-2 { display: grid; grid-template-columns: 340px 1fr; gap: 20px; }
        .lesson-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
        .lesson-card { background: white; border: 1px solid #e2e8f0; border-top: 4px solid var(--primary); padding: 18px; border-radius: 8px; }
        .grade-badge { display: inline-block; padding: 6px 12px; background: #e0f2fe; color: #0369a1; border-radius: 20px; font-size: 13px; font-weight: bold; margin-right: 5px; margin-bottom: 8px; cursor: pointer; }
        .grade-badge.active { background: var(--primary); color: white; }
        .ai-box { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: left; }
        iframe { width: 100%; height: 500px; border: 1px solid #cbd5e1; border-radius: 6px; }
      </style>
    </head>
    <body>
      <header>
        <div style="font-size:18px; font-weight:bold;">📐 Math HoangYen - Tự Động Sinh Bài Tập AI</div>
        <div>👤 ${user.username} (${user.role}) | <a href="/logout" style="color:white; font-weight:bold;">Đăng xuất</a></div>
      </header>

      <div class="nav-tabs">
        <button class="tab-btn active" onclick="switchTab('lessons', this)">📚 Mục 1: Danh Mục Bài Giảng</button>
        <button class="tab-btn" onclick="switchTab('exercises', this)">📝 Mục 2: Ngân Hàng Bài Tập AI</button>
        <button class="tab-btn" onclick="switchTab('results', this)">📊 Mục 3: Bảng Điểm Học Sinh</button>
      </div>

      <div class="container">
        <!-- TAB 1: BÀI GIẢNG -->
        <div id="tab-lessons" class="tab-content active">
          <div class="${user.role === 'Admin' ? 'grid-2' : ''}">
            ${user.role === 'Admin' ? `
            <div class="card">
              <h3>📂 Thêm Bài Học Mới</h3>
              <form action="/api/lessons" method="POST" enctype="multipart/form-data">
                <label>Mã bài học:</label>
                <input type="text" name="code" placeholder="VD: MATH-L10-01" required>
                
                <label>Tên bài học:</label>
                <input type="text" name="title" required placeholder="VD: Phép Tích Vô Hướng">
                
                <label>Khối Cấp Học:</label>
                <select name="level" id="formLevel" onchange="updateGradeDropdown(this.value)">
                  <option value="Cấp 1 (Tiểu học)">Cấp 1 (Tiểu học)</option>
                  <option value="Cấp 2 (THCS)" selected>Cấp 2 (THCS)</option>
                  <option value="Cấp 3 (THPT)">Cấp 3 (THPT)</option>
                </select>

                <label>Lớp Học Cụ Thể:</label>
                <select name="grade_class" id="formGrade"></select>

                <label>Chuyên đề Toán:</label>
                <input type="text" name="topic" placeholder="Đại số / Hình học">

                <label>Tệp Bài Giảng (PDF):</label>
                <input type="file" name="pdf" accept="application/pdf">

                <div class="ai-box">
                  <label style="font-weight:bold; color:#15803d; cursor:pointer;">
                    <input type="checkbox" name="auto_gen_quiz" value="on" checked style="width:auto; margin-right:5px;">
                    ✨ Tự động phân tích & sinh bài tập AI
                  </label>
                </div>

                <button type="submit" class="btn" style="width: 100%;">Thêm Bài Học Mới</button>
              </form>
            </div>
            ` : ''}

            <div>
              <div class="card">
                <h3>🏷️ Chọn Xem Lớp Học</h3>
                <span class="grade-badge active" onclick="filterByGrade('', this)">Tất Cả Lớp</span>
                <span class="grade-badge" onclick="filterByGrade('Lớp 1', this)">Lớp 1</span>
                <span class="grade-badge" onclick="filterByGrade('Lớp 6', this)">Lớp 6</span>
                <span class="grade-badge" onclick="filterByGrade('Lớp 10', this)">Lớp 10</span>
                <span class="grade-badge" onclick="filterByGrade('Lớp 12', this)">Lớp 12</span>
                <hr style="border:none; border-top:1px solid #e2e8f0; margin:15px 0;">
                <div class="lesson-grid" id="lessonGrid"></div>
              </div>

              <div class="card" id="pdfViewerCard" style="display:none;">
                <h3 id="pdfTitle">Nội dung bài học</h3>
                <iframe id="pdfFrame" src="about:blank"></iframe>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: BÀI TẬP TRẮC NGHIỆM -->
        <div id="tab-exercises" class="tab-content">
          <div class="card">
            <h3>📝 Bài Tập Trắc Nghiệm Tự Động</h3>
            <label>Chọn Bài Học Cần Luyện Tập:</label>
            <select id="doExerciseSelect" onchange="loadQuizForStudent(this.value)">
              <option value="">-- Chọn bài học --</option>
            </select>

            <div id="quizDoingArea" style="margin-top: 20px; display:none;">
              <form id="studentQuizForm"></form>
              <button class="btn" onclick="submitStudentQuiz()" style="margin-top: 15px; background:#16a34a;">Nộp Bài Làm</button>
              <div id="quizResultNotify" style="margin-top:15px; font-weight:bold;"></div>
            </div>
          </div>
        </div>

        <!-- TAB 3: BẢNG ĐIỂM -->
        <div id="tab-results" class="tab-content">
          <div class="card">
            <h3>📊 Bảng Điểm Học Sinh</h3>
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Học Sinh</th><th>Bài Học</th><th>Lớp</th><th>Điểm Số</th><th>Đánh Giá</th>
                </tr>
              </thead>
              <tbody id="resultsTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <script>
        const userRole = "${user.role}";

        function updateGradeDropdown(level) {
          const select = document.getElementById('formGrade');
          if(!select) return;
          select.innerHTML = '';
          let grades = level === 'Cấp 1 (Tiểu học)' ? ['Lớp 1','Lớp 2','Lớp 3','Lớp 4','Lớp 5'] :
                       level === 'Cấp 2 (THCS)' ? ['Lớp 6','Lớp 7','Lớp 8','Lớp 9'] : ['Lớp 10','Lớp 11','Lớp 12'];
          grades.forEach(g => { select.innerHTML += \`<option value="\${g}">\${g}</option>\`; });
        }

        function switchTab(tabName, btn) {
          document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('tab-' + tabName).classList.add('active');
          btn.classList.add('active');

          if(tabName === 'lessons') loadLessons();
          if(tabName === 'exercises') loadQuizOptions();
          if(tabName === 'results') loadResults();
        }

        async function loadLessons(grade = '') {
          const res = await fetch('/api/lessons?grade_class=' + encodeURIComponent(grade));
          const lessons = await res.json();
          const grid = document.getElementById('lessonGrid');
          grid.innerHTML = '';

          lessons.forEach(l => {
            grid.innerHTML += \`
              <div class="lesson-card">
                <small style="color:var(--primary); font-weight:bold;">\${l.grade_class}</small>
                <h4 style="margin: 8px 0;">\${l.title}</h4>
                <button class="btn" onclick="viewPdf('\${l.title}', '\${l.pdf_path}')">Xem File PDF</button>
                \${userRole === 'Admin' ? \`<button class="btn btn-danger" onclick="deleteLesson(\${l.id})">Xóa</button>\` : ''}
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
          if(!path) return alert('Chưa đính kèm file PDF!');
          document.getElementById('pdfViewerCard').style.display = 'block';
          document.getElementById('pdfTitle').innerText = title;
          document.getElementById('pdfFrame').src = path;
        }

        async function deleteLesson(id) {
          if(confirm('Xóa bài học này?')) {
            await fetch('/api/lessons/' + id, { method: 'DELETE' });
            loadLessons();
          }
        }

        async function loadQuizOptions() {
          const res = await fetch('/api/lessons');
          const lessons = await res.json();
          const selStudent = document.getElementById('doExerciseSelect');
          let options = '<option value="">-- Chọn Bài Học --</option>';
          lessons.forEach(l => { options += \`<option value="\${l.id}">[\${l.grade_class}] \${l.title}</option>\`; });
          selStudent.innerHTML = options;
        }

        async function loadQuizForStudent(lessonId) {
          if(!lessonId) return;
          const res = await fetch('/api/quizzes?lesson_id=' + lessonId);
          const quizzes = await res.json();
          const area = document.getElementById('quizDoingArea');
          const form = document.getElementById('studentQuizForm');
          
          if(quizzes.length === 0) {
            area.style.display = 'none';
            return alert('Bài học này chưa có câu hỏi trắc nghiệm!');
          }

          area.style.display = 'block';
          form.innerHTML = '';
          quizzes.forEach((q, idx) => {
            form.innerHTML += \`
              <div style="margin-bottom: 15px; padding:12px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0;">
                <p><b>Câu \${idx + 1}: \${q.question}</b></p>
                <label style="display:block; margin:4px 0;"><input type="radio" name="q_\${q.id}" value="A"> A. \${q.option_a}</label>
                <label style="display:block; margin:4px 0;"><input type="radio" name="q_\${q.id}" value="B"> B. \${q.option_b}</label>
                <label style="display:block; margin:4px 0;"><input type="radio" name="q_\${q.id}" value="C"> C. \${q.option_c}</label>
                <label style="display:block; margin:4px 0;"><input type="radio" name="q_\${q.id}" value="D"> D. \${q.option_d}</label>
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
          document.getElementById('quizResultNotify').innerHTML = \`Kết quả: \${result.score}/100 điểm - Đánh giá: \${result.status}\`;
        }

        async function loadResults() {
          const res = await fetch('/api/results');
          const data = await res.json();
          const tbody = document.getElementById('resultsTableBody');
          tbody.innerHTML = '';
          data.forEach((r, i) => {
            tbody.innerHTML += \`
              <tr>
                <td>\${i + 1}</td>
                <td>\${r.username}</td>
                <td>\${r.lesson_name || ''}</td>
                <td>\${r.grade_class || ''}</td>
                <td><b>\${r.score}</b></td>
                <td>\${r.status}</td>
              </tr>
            \`;
          });
        }

        if(document.getElementById('formLevel')) updateGradeDropdown('Cấp 2 (THCS)');
        loadLessons();
      </script>
    </body>
    </html>
  `);
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server Math HoangYen đang chạy thành công tại cổng: ${PORT}`);
  });
});
