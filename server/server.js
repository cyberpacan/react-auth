const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
const port = 5000;

//дополнительные компоненты для express-приложения
app.use(bodyParser.json()); //удобный парсер json
app.use(cors()); //обход кросдоменных блокировок

//создание бд в папке сервера
const db = new sqlite3.Database("./exampleDB.db");

//создание таблиц ролей и пользователей, запись в таблицу ролей админа и юзера
db.serialize(() => {
    db.run(
        "create table if not exists roles(id integer primary key autoincrement, role text unique)"
    );

    db.run(
        "create table if not exists users(id integer primary key autoincrement, username text unique, password text, roleid integer, foreign key(roleid) references roles(id))"
    );

    db.run("insert or ignore into roles(role) values('admin')");
    db.run("insert or ignore into roles(role) values('user')");

    db.run(
        "create table if not exists categories(id integer primary key autoincrement, name text not null unique)"
    );

    db.run(
        "create table if not exists products(id integer primary key autoincrement, name text not null, description text, price real, categoryid integer, userid integer, foreign key(categoryid) references categories(id), foreign key(userid) references users(id))"
    );
});

function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (token == null)
        return res.status(401).json({ error: "Токен не обнаружен" });
    jwt.verify(token, "secret", (err, user) => {
        if (err) return res.status(403).json({ error: "Невалидный токен" });
        req.user = user;
        next();
    });
}

//регистрация пользователя
app.post("/register", async (req, res) => {
    const { username, password } = req.body; //получаем данные пользователя из тела запроса
    const hashedPassword = await bcrypt.hash(password, 10); //хэшируем пароль

    db.get("select count(*) as count from users", (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        //проверяем, есть ли в бд пользователи
        const isFirstUser = row.count === 0;
        //первый созданный пользователь получит роль админа, остальные юзер
        const roleName = isFirstUser ? "admin" : "user";
        db.get("select id from roles where role=?", [roleName], (err, role) => {
            if (err || !role) {
                return res.status(500).json({ error: err.message });
            }
            db.run(
                "insert into users(username, password, roleid) values(?,?,?)",
                [username, hashedPassword, role.id],
                (err) => {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    res.status(201).json({ id: this.lastID }); //возвращаем id нового юзера в случае успешного выполнения запроса
                }
            );
        });
    });
});

//логин пользователя
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    //извлекаем из бд информацию о пользователе по имени, переданному запросом
    db.get(
        "select users.id, users.username, users.password, roles.role from users join roles on users.roleid=roles.id where username=?",
        [username],
        async (err, user) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!user) {
                return res
                    .status(400)
                    .json({ error: "Пользователь не найден" });
            }
            //сравнение хэшей пароля из запроса и из бд
            const isValidPassword = await bcrypt.compare(
                password,
                user.password
            );
            if (!isValidPassword) {
                return res.status(400).json({ error: "Неверный пароль" });
            }
            //генерируем jwt-токен пользователя сроком жизни 1 час с секретным кодом "secret", отправляем пользователю
            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role },
                "secret",
                {
                    expiresIn: "1h",
                }
            );
            res.json({ token });
        }
    );
});

//получение доступа на защищенную страницу
app.get("/protected", authenticateToken, (req, res) => {
    res.json({ message: "Вы зашли на защищенную страницу" });
});

app.get("/profile", authenticateToken, (req, res) => {
    const username = req.user.username;
    const query =
        "select users.username, roles.role from users join roles on users.roleid=roles.id where username=?";

    db.get(query, [username], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.sendStatus(404);
        }
        res.json({ user: row });
    });
});

//проверка роли админа
const isAdmin = (req, res, next) => {
    if (req.user.role !== 1) {
        //1 - id роли админа
        return res.status(403).json({ message: "Доступ запрещен" });
    }
    next(); //передача управления следующему методу
};

//добавление категорий (только для админа)
app.post("/categories", authenticateToken, (req, res) => {
    const { name } = req.body;
    db.run("insert into categories(name) values(?)", [name], (err) => {
        if (err) {
            return res.status(500).json({ message: "Ошибка базы данных" });
        }
        res.status(201).json({
            message: "Категория создана",
            categoryId: this.lastID,
        });
    });
});

//запрос категорий для вывода
app.get("/categories", (req, res) => {
    db.all("select * from categories", [], (err, categories) => {
        if (err) {
            return res.status(500).json({ message: "Ошибка базы данных" });
        }
        res.json(categories);
    });
});

//добавление товаров
app.post("/products", authenticateToken, (req, res) => {
    const { name, description, price, categoryId } = req.body;
    db.run(
        "insert into products(name, description, price, categoryid, userid) values(?,?,?,?,?)",
        [name, description, price, categoryId, req.user.id],
        (err) => {
            if (err) {
                return res.status(500).json({ message: "Ошибка базы данных" });
            }
            res.status(201).json({
                mesage: "Товар добавлен",
                productId: this.lastID,
            });
        }
    );
});

//получение всех товаров
app.get("/products", (req, res) => {
    db.all("select * from products", [], (err, products) => {
        if (err) {
            return res.status(500).json({ message: "Ошибка базы данных" });
        }
        res.json(products);
    });
});

//получение товара по id
app.get("/products/:id", (req, res) => {
    const { id } = req.params;
    db.get("select * from products where id=?", [id], (err, product) => {
        if (err || !product) {
            return res.status(404).json({ message: "Товар не найден" });
        }
        res.json(product);
    });
});

//запуск сервера
app.listen(port, () => {
    console.log(`Сервер запущен по адресу http://localhost:${port}`);
});
