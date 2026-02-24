import { app } from '../server/index.js'

export default function apiCatchAllHandler(req, res) {
  return app(req, res)
}
