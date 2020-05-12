const MediaServer = require('medooze-media-server');
const { SDPInfo } = require('semantic-sdp');
const internalIp = require('internal-ip');
const express = require('express');
const bodyParser = require('body-parser');

// Init MediaServer
const ip = process.env.IP_ADDRESS || internalIp.v4.sync();
const endpoint = MediaServer.createEndpoint(ip);

const capabilities = MediaServer.getDefaultCapabilities();

// Limit MediaServer video capabilities to H264 only
capabilities.video.codecs = ['h264;packetization-mode=1'];

// Variable for storing ref to incoming stream
let incomingStream;

// Init HTTP server
const app = express();
app.use(express.static('public'));
app.use(bodyParser.text());

// Init WebRTC loopback connection
app.post('/connect', (req, res) => {
  const offer = SDPInfo.process(req.body);

  const transport = endpoint.createTransport(offer);
  transport.setRemoteProperties(offer);

  const answer = offer.answer({
    dtls: transport.getLocalDTLSInfo(),
    ice: transport.getLocalICEInfo(),
    candidates: endpoint.getLocalCandidates(),
    capabilities,
  });
  transport.setLocalProperties(answer);

  incomingStream = transport.createIncomingStream(offer.getFirstStream());

  const outgoingStream = transport.createOutgoingStream({
    audio: true,
    video: true,
  });
  outgoingStream.attachTo(incomingStream);
  answer.addStream(outgoingStream.getStreamInfo());

  res.json({
    type: 'answer',
    sdp: answer.unify().toString(),
  });
});

// Start HTTP server
const listener = app.listen(process.env.PORT || 3000, () => {
  console.log(`Listening on ${ip} port ${listener.address().port}`);
});
