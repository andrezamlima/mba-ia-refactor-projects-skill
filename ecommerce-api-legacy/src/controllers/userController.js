const userModel = require('../models/userModel')
const jwt = require('jsonwebtoken')
const { secret } = require('../config/settings')

function login(req, res) {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'email e password sao obrigatorios' })
  }

  const user = userModel.findByEmail(email)
  if (!user || !userModel.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciais invalidas' })
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, secret, { expiresIn: '8h' })
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } })
}

function deleteUser(req, res) {
  const id = parseInt(req.params.id, 10)
  const user = userModel.findById(id)
  if (!user) {
    return res.status(404).json({ error: 'Usuario nao encontrado' })
  }
  userModel.deleteById(id)
  res.json({ msg: 'Usuario e dados associados removidos com sucesso' })
}

module.exports = { login, deleteUser }
