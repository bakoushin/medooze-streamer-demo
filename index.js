const { spawn } = require('child_process');
const MediaServer = require('medooze-media-server');
const { SDPInfo, MediaInfo, CodecInfo } = require('semantic-sdp');
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

// Variable for storing ref to working GStreamer process
let gstreamerProcess;

// IP and ports for streaming to
const STREAMER_REMOTE_IP = '127.0.0.1';
const STREAMER_AUDIO_PORT = 5004;
const STREAMER_VIDEO_PORT = 5006;

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

// Start recording
app.get('/recorder-start', () => {
  // Spawn GStreamer process which will listen to RTP stream from MediaServer.
  // GStreamer is set up to mux H264 video stream with AAC audio stream into a single MP4 file.
  // Since WebRTC normally uses Opus as audio codec, it will be transcoded into AAC by GStreamer.
  gstreamerProcess = spawn(
    'gst-launch-1.0',
    [
      '--eos-on-shutdown',
      `mp4mux faststart=true name=mux ! filesink location=${Date.now()}.mp4`,
      `udpsrc address=${STREAMER_REMOTE_IP} port=${STREAMER_AUDIO_PORT} caps="application/x-rtp,clock-rate=48000,payload=109" name=audio`,
      'audio. ! queue ! rtpjitterbuffer ! rtpopusdepay ! opusdec ! audioconvert ! audioresample ! avenc_aac ! aacparse ! mux.',
      `udpsrc address=${STREAMER_REMOTE_IP} port=${STREAMER_VIDEO_PORT} caps="application/x-rtp,clock-rate=90000,payload=96" name=video`,
      'video. ! queue ! rtpjitterbuffer ! rtph264depay ! h264parse ! mux.',
    ]
      .join(' ')
      .split(' ')
  );
  console.log('GStreamer started');

  // Wait for GStreamer to initialize and start MediaServer Streamer
  gstreamerProcess.stdout.on('data', (chunk) => {
    chunk
      .toString()
      .split(/\r?\n/g)
      .forEach((line) => {
        if (line.indexOf('Setting pipeline to PLAYING') !== -1) {
          // Create new Streamer
          streamer = MediaServer.createStreamer();

          // Audio stream

          // Start audio stream
          const audio = new MediaInfo('audio', 'audio');
          audio.addCodec(new CodecInfo('opus', 109));

          // Create StreamerSession for audio
          streamerSessionAudio = streamer.createSession(audio, {
            remote: {
              ip: STREAMER_REMOTE_IP,
              port: STREAMER_AUDIO_PORT,
            },
          });

          // Attach audio track from incoming stream to streamer session
          streamerSessionAudio
            .getOutgoingStreamTrack()
            .attachTo(incomingStream.getAudioTracks()[0]);

          // Video stream

          // Create codec description
          const video = new MediaInfo('video', 'video');
          video.addCodec(new CodecInfo('h264', 96));

          // Create StreamerSession for video
          streamerSessionVideo = streamer.createSession(video, {
            remote: {
              ip: STREAMER_REMOTE_IP,
              port: STREAMER_VIDEO_PORT,
            },
          });

          // Attach video track from incoming stream to streamer session
          streamerSessionVideo
            .getOutgoingStreamTrack()
            .attachTo(incomingStream.getVideoTracks()[0]);

          console.log('Recording started');
        }
      });
  });

  gstreamerProcess.on('exit', (code, signal) => {
    console.log(`GStreamer stopped with exit code ${code} (${signal})`);

    // Stop streamer
    streamerSessionVideo.stop();
    streamerSessionAudio.stop();
    streamer.stop();
    console.log('Streamer stopped');
  });

  gstreamerProcess.on('error', (err) => {
    console.error('GStreamer error:', err);
  });

  gstreamerProcess.stdout.pipe(process.stdout);
  gstreamerProcess.stderr.pipe(process.stderr);
});

// Stop recording
app.get('/recorder-stop', () => {
  gstreamerProcess.kill('SIGINT');
  console.log('GStreamer stopped');
});

// Start HTTP server
const listener = app.listen(process.env.PORT || 3000, () => {
  console.log(`Listening on ${ip} port ${listener.address().port}`);
});
