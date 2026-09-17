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
      headers: {
        Authorization: "Bearer " + process.env.API_KEY,
      },
    })
    .catch((err) => {
      console.log(err);
      throw {
        code: 400,
        message: "A problem occurred while getting images",
      };
    });

  return images.data;
}

function shuffle(arr) {
  const shuffledArr = [...arr];

  for (let i = shuffledArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [shuffledArr[i], shuffledArr[j]] = [
      shuffledArr[j],
      shuffledArr[i],
    ];
  }

  return shuffledArr;
}

function createDeck(n, images) {
  const cards = [];

  for (let crd = 0; crd < n; crd++) {
    const symbols = [images[0]];

    for (let sym = 1; sym < n; sym++) {
      symbols.push(images[crd * (n - 1) + sym]);
    }

    cards.push(symbols.slice());
  }

  for (let cat = 1; cat < n; cat++) {
    for (let crd = 0; crd < n - 1; crd++) {
      const symbols = [images[cat]];

      for (let sym = 1; sym < n; sym++) {
        symbols.push(
          images[
            1 +
              sym * (n - 1) +
              (((cat - 1) * (sym - 1) + crd) % (n - 1))
          ]
        );
      }

      cards.push(symbols.slice());
    }
  }

  return cards;
}

const app = express();
const PORT = process.env.PORT;

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://dobble-online.netlify.app",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());

let shuffledDeck = null;
let lastCard = null;
let clicks = 0;

const players = [];

// Used to keep track of the countdown timer.
let startTimeout = null;

// --------------------------------------------------
// Initialize the game deck BEFORE starting server
// --------------------------------------------------

async function initializeGame() {
  console.log("Initializing game...");

  const images = await getImages();

  const imagesArray = images.icons.map((icon) => {
    return {
      src: icon.raster_sizes[5].formats[0].preview_url,
      alt:
        icon.categories.length > 0
          ? icon.categories[0].name
          : "img",
    };
  });

  const deck = createDeck(8, imagesArray);

  shuffledDeck = shuffle(deck);

  console.log(
    `Game initialized successfully with ${shuffledDeck.length} cards.`
  );
}

// --------------------------------------------------
// Check winner
// --------------------------------------------------

const checkWinner = () => {
  let winner = [{ name: "", score: 0 }];

  for (const player of players) {
    if (player.score > winner[0].score) {
      winner = [player];
    } else if (player.score === winner[0].score) {
      winner.push(player);
    }
  }

  io.emit("winner", winner);
};

// --------------------------------------------------
// Socket.IO
// --------------------------------------------------

io.on("connection", (socket) => {
  console.log("New Websocket connection:", socket.id);

  socket.on("setUsername", (username) => {
    // Prevent the same socket from registering multiple times.
    const existingPlayer = players.find(
      (player) => player.id === socket.id
    );

    if (existingPlayer) {
      return;
    }

    players.push({
      id: socket.id,
      name: username,
      score: 0,
    });

    io.emit("playersState", players);

    // Start game when there are exactly 2 players.
    if (players.length === 2) {
      // Safety check. This should always be initialized because
      // the server only starts after initializeGame() completes.
      if (!Array.isArray(shuffledDeck)) {
        console.error(
          "Cannot start game: shuffledDeck is not initialized."
        );
        return;
      }

      // Prevent an existing countdown from being scheduled twice.
      if (startTimeout) {
        clearTimeout(startTimeout);
      }

      const startTime = Date.now() + 3000;

      io.emit("startCountdown", startTime);

      startTimeout = setTimeout(() => {
        startTimeout = null;

        // Check that both players are still connected.
        if (players.length !== 2) {
          console.log(
            "Game start cancelled because there are no longer 2 players."
          );
          return;
        }

        // Make sure there are enough cards.
        if (shuffledDeck.length < 3) {
          console.error(
            "Not enough cards to start the game."
          );
          checkWinner();
          return;
        }

        // Draw the common/last card.
        lastCard = shuffledDeck.pop();

        io.emit("deckState", lastCard);

        // Give each player a card.
        players.forEach((player) => {
          io.to(player.id).emit(
            "drawnCard",
            shuffledDeck.pop()
          );
        });

        // Start the game ONCE, not once per player.
        io.emit("startGame");
      }, 3000);
    }
  });

  // --------------------------------------------------
  // Get current deck
  // --------------------------------------------------

  socket.on("getDeck", () => {
    socket.emit("deckState", shuffledDeck);
  });

  // --------------------------------------------------
  // Get players
  // --------------------------------------------------

  socket.on("getPlayers", () => {
    socket.emit("playersState", players);
  });

  // --------------------------------------------------
  // Update score
  // --------------------------------------------------

  socket.on("updateScore", () => {
    if (clicks === 0) {
      const player = players.find(
        (player) => player.id === socket.id
      );

      // Make sure the player still exists.
      if (!player) {
        return;
      }

      player.score++;

      socket.emit("playersState", players);

      io.emit(
        "message",
        `נקודה ל${player.name}!`
      );

      clicks++;
    }
  });

  // --------------------------------------------------
  // Next card
  // --------------------------------------------------

  socket.on("nextCard", () => {
    clicks = 0;

    // Safety check.
    if (!Array.isArray(shuffledDeck)) {
      console.error(
        "Cannot draw next card: shuffledDeck is not initialized."
      );
      return;
    }

    if (shuffledDeck.length >= 2) {
      const newDeckCard = shuffledDeck.pop();

      io.emit("deckState", newDeckCard);

      const player = players.find(
        (player) => player.id === socket.id
      );

      if (!player) {
        return;
      }

      // Give the player who clicked the previous last card.
      io.to(player.id).emit(
        "drawnCard",
        lastCard
      );

      // Give the remaining players a new card.
      const restOfPlayers = players.filter(
        (pl) => pl.id !== socket.id
      );

      restOfPlayers.forEach((pla) => {
        io.to(pla.id).emit(
          "drawnCard",
          shuffledDeck.pop()
        );
      });

      // The newly displayed deck card becomes the last card.
      lastCard = newDeckCard;
    } else {
      checkWinner();
    }
  });

  // --------------------------------------------------
  // Disconnect
  // --------------------------------------------------

  socket.on("disconnect", () => {
    console.log(
      "Websocket disconnected:",
      socket.id
    );

    const index = players.findIndex(
      (player) => player.id === socket.id
    );

    if (index !== -1) {
      players.splice(index, 1);
    }

    // Cancel countdown if a player leaves before the game starts.
    if (startTimeout && players.length < 2) {
      clearTimeout(startTimeout);
      startTimeout = null;

      console.log(
        "Game countdown cancelled because a player disconnected."
      );
    }

    io.emit("playersState", players);
  });
});

// --------------------------------------------------
// Start server ONLY after game initialization
// --------------------------------------------------

initializeGame()
  .then(() => {
    server.listen(PORT, () => {
      console.log("connection succeeded!");
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error(
      "Failed to initialize game. Server will not start.",
      err
    );

    process.exit(1);
  });

// app.use("/games", require("./Routes/gameRouter"));
// app.use("/users", require("./Routes/userRouter"));
// require("./DL/db").myConnect();
