require("dotenv").config();
const axios = require("axios");
const { log } = require("console");
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
    origin: "https://dobble-online.netlify.app",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());
let shuffledDeck;
let lastCard;
let clicks = 0;
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
    shuffledDeck = shuffle(deck);
  } catch (err) {
    console.error(err);
  }
})();
const checkWinner = () => {
  let winner = [{ name: "", score: 0 }];
  for (const player of players) {
    if (player.score > winner[0].score) {
      winner = [player];
    } else if (player.score === winner[0].score) {
      winner.push(player);
    } else {
      continue;
    }
  }
  io.emit("winner", winner);
};
io.on("connection", (socket) => {
  console.log("New Websocket connection:", socket.id);
  socket.on("setUsername", (username) => {
    players.push({ id: socket.id, name: username, score: 0 });
    if (players.length === 2) {
      //change to 2 players
      const startTime = Date.now() + 3000; // Game starts in 3 seconds
      io.emit("startCountdown", startTime);
      const timeout = setTimeout(() => {
        lastCard = shuffledDeck.pop();
        io.emit("deckState", lastCard);
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
    if (clicks === 0) {
      const player = players.find((player) => {
        return player.id === socket.id;
      });
      player.score++;
      socket.emit("playersState", players);
      io.emit("message", `נקודה ל${player.name}!`);
      clicks++;
    }
  });
  socket.on("nextCard", () => {
    clicks = 0;
    if (shuffledDeck.length >= 2) {
      const newDeckCard = shuffledDeck.pop();
      io.emit("deckState", newDeckCard);
      const player = players.find((player) => {
        return player.id === socket.id;
      });
      io.to(player.id).emit("drawnCard", lastCard);
      const restOfPlayers = players.filter((pl) => {
        return pl.id != socket.id;
      });

      restOfPlayers.forEach((pla) => {
        io.to(pla.id).emit("drawnCard", shuffledDeck.pop());
      });
      lastCard = newDeckCard;
    } else {
      checkWinner();
    }
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
