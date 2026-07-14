const express = require('express');
const {
  searchAndNotifyDonors,
} = require('../controllers/donorSearchController');

function createDonorSearchRouter(authRequired) {
  const router = express.Router();

  // POST /api/donors/search
  router.post('/search', authRequired, (req, res) =>
    searchAndNotifyDonors(req, res)
  );

  return router;
}

module.exports = createDonorSearchRouter;

