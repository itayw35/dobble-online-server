const gameLogic = require("../BL/gameLogic");
const express = require("express");
const router = express.Router();

router.get("/images", async (req, res) => {
  try {
    const images = await gameLogic.getImages();
    res.status(images.code).send(images.message);
  } catch (err) {
    console.log(err);

    res.status(err.code || 400).send(err.message);
  }
});
module.exports = router;
