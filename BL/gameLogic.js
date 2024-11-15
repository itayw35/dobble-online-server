const axios = require("axios");
async function getImages() {
  const requestUrl =
    "https://api.iconfinder.com/v4/icons/search?query=animal&count=50";
  const images = await axios
    .request(requestUrl, {
      headers: { Authorization: "Bearer " + process.env.API_KEY },
    })
    .catch((err) => {
      console.log(err);
      throw { code: 400, message: "a problem occured" };
    });
  return { code: 200, message: images.data };
}
module.exports = { getImages };
