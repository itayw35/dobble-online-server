require("dotenv").config();
const axios = require("axios");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

async function getImages() {
  const requestUrl =
    "https://api.iconfinder.com/v4/icons/search?query=candy&count=57";
  const images = await axios
    .request(requestUrl, {
      headers: { Authorization: "Bearer " + process.env.API_KEY },
    })
    .catch((err) => {
      console.log(err);
      throw { code: 400, message: "a problem occured" };
    });
  return images.data;
}
function shuffle(arr) {
  let shuffledArr = [...arr];
  for (let i = shuffledArr.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [shuffledArr[i], shuffledArr[j]] = [shuffledArr[j], shuffledArr[i]];
  }
  return shuffledArr;
}
function createDeck(n, images) {
  let cards = [];
  for (let crd = 0; crd < n; crd++) {
    let symbols = [images[0]];
    for (let sym = 1; sym < n; sym++) {
      symbols.push(images[crd * (n - 1) + sym]);
    }
    cards.push(symbols.slice());
  }
  for (let cat = 1; cat < n; cat++) {
    for (let crd = 0; crd < n - 1; crd++) {
      let symbols = [images[cat]];
      for (let sym = 1; sym < n; sym++) {
        symbols.push(
          images[1 + sym * (n - 1) + (((cat - 1) * (sym - 1) + crd) % (n - 1))]
        );
      }
      cards.push(symbols.slice());
    }
  }
  return cards;
}
const app = express(),
  PORT = process.env.PORT;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());
let shuffledDeck;
const players = [];
(async () => {
  try {
    const images = await getImages();
    const imagesArray = images.icons.map((icon) => {
      return {
        src: icon.raster_sizes[5].formats[0].preview_url,
        alt: icon.categories.length > 0 ? icon.categories[0].name : "img",
      };
    });

    let deck = createDeck(8, imagesArray);
    console.log(deck[0]);
    shuffledDeck = shuffle(deck);
    console.log(shuffledDeck[0]);
  } catch (err) {
    console.error(err);
  }
})();
io.on("connection", (socket) => {
  console.log("New Websocket connection:", socket.id);
  socket.on("setUsername", (username) => {
    players.push({ id: socket.id, name: username, score: 0 });
    if (players.length === 2) {
      //change to 2 players
      const startTime = Date.now() + 3000; // Game starts in 3 seconds
      io.emit("startCountdown", startTime);
      const timeout = setTimeout(() => {
        io.emit("deckState", shuffledDeck.pop());
        players.forEach((player) => {
          io.to(player.id).emit("drawnCard", shuffledDeck.pop());
          io.emit("startGame");
        });
      }, 3000);
      return () => {
        clearTimeout(timeout);
      };
    }
  });
  socket.on("getDeck", () => {
    socket.emit("deckState", shuffledDeck);
  });
  socket.on("getPlayers", () => {
    socket.emit("playersState", players);
  });
  socket.on("updateScore", () => {
    const player = players.find((player) => {
      return player.id === socket.id;
    });
    player.score++;
    socket.emit("playersState", players);
    io.emit("message", `נקודה ל${player.name}!`);
  });
  socket.on("disconnect", () => {
    const index = players.findIndex((player) => {
      return player.id === socket.id;
    });
    players.splice(index, 1);
  });
});

// app.use("/games", require("./Routes/gameRouter"));
// app.use("/users", require("./Routes/userRouter"));
server.listen(PORT, () => console.log("connection succeeded!"));
// require("./DL/db").myConnect();
