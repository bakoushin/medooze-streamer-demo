const { spawn } = require('child_process');
const MediaServer = require('medooze-media-server');
const { SDPInfo, MediaInfo, CodecInfo } = require('semantic-sdp');
const internalIp = require('internal-ip');
const express = require('express');

// Init MediaServer
const ip = process.env.IP_ADDRESS || internalIp.v4.sync();
const endpoint = MediaServer.createEndpoint(ip);

const capabilities = MediaServer.getDefaultCapabilities();

// Limit MediaServer video capabilities to H264 only
capabilities.video.codecs = ['h264;packetization-mode=1'];

// Variable for storing ref to incoming stream
let incomingStream;

// Variables for storing ref to working processes
let gstreamerProcess;
let ffmpegProcess;

// Variables for storing ref to Streamer instance and its sessions
let streamer;
let streamerSessionAudio;
let streamerSessionVideo;

// Streaming parameters
const STREAMER_REMOTE_IP = '127.0.0.1';

const STREAMER_AUDIO_PORT = 5004;
const STREAMER_AUDIO_CODEC = 'opus';
const STREAMER_AUDIO_PAYLOAD = 109;
const STREAMER_AUDIO_CLOCKRATE = 48000;
const STREAMER_AUDIO_CHANNELS = 2;

const STREAMER_VIDEO_PORT = 5006;
const STREAMER_VIDEO_CODEC = 'h264';
const STREAMER_VIDEO_PAYLOAD = 96;
const STREAMER_VIDEO_CLOCKRATE = 90000;

// Function creates new Streamer and starts streaming.
// Will be called when external process is ready to receive streams.
const startStreamer = () => {
  // Create new Streamer
  streamer = MediaServer.createStreamer();

  // Audio stream

  // Start audio stream
  const audio = new MediaInfo('audio', 'audio');
  audio.addCodec(new CodecInfo(STREAMER_AUDIO_CODEC, STREAMER_AUDIO_PAYLOAD));

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
  video.addCodec(new CodecInfo(STREAMER_VIDEO_CODEC, STREAMER_VIDEO_PAYLOAD));

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
};

// Init HTTP server
const app = express();
app.use(express.static('public'));
app.use(express.text());

// Init WebRTC loopback connection
app.post('/connect', (req, res) => {
  const offer = SDPInfo.parse(req.body);

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

// Start GStreamer recording
app.get('/gstreamer-start', (req, res) => {
  // If there is another process running, do nothing.
  if (streamer) {
    res.end();
    return;
  }

  // Spawn GStreamer process which will listen to RTP stream from MediaServer.
  // GStreamer is set up to mux H264 video stream with AAC audio stream into a single MP4 file.
  // Since WebRTC normally uses Opus as audio codec, it will be transcoded into AAC by GStreamer.
  gstreamerProcess = spawn(
    'gst-launch-1.0',
    [
      '--eos-on-shutdown',
      `mp4mux faststart=true name=mux ! filesink location=${Date.now()}.mp4`,
      `udpsrc address=${STREAMER_REMOTE_IP} port=${STREAMER_AUDIO_PORT} caps="application/x-rtp,clock-rate=${STREAMER_AUDIO_CLOCKRATE},payload=${STREAMER_AUDIO_PAYLOAD}" name=audio`,
      'audio. ! queue ! rtpjitterbuffer ! rtpopusdepay ! opusdec ! audioconvert ! audioresample ! avenc_aac ! aacparse ! mux.',
      `udpsrc address=${STREAMER_REMOTE_IP} port=${STREAMER_VIDEO_PORT} caps="application/x-rtp,clock-rate=${STREAMER_VIDEO_CLOCKRATE},payload=${STREAMER_VIDEO_PAYLOAD}" name=video`,
      'video. ! queue ! rtpjitterbuffer ! rtph264depay ! h264parse ! mux.',
    ]
      .join(' ')
      .split(' ')
  );
  console.log('GStreamer started. Waiting for pipeline initialization...');

  // Wait for GStreamer to initialize and start Streamer
  gstreamerProcess.stdout.on('data', (chunk) => {
    chunk
      .toString()
      .split(/\r?\n/g)
      .forEach((line) => {
        if (line.indexOf('Setting pipeline to PLAYING') !== -1) {
          startStreamer();
          console.log('GStreamer recording started');
        }
      });
  });

  gstreamerProcess.on('exit', (code, signal) => {
    console.log(`GStreamer stopped with exit code ${code} (${signal})`);

    // Stop streamer
    streamerSessionVideo.stop();
    streamerSessionAudio.stop();
    streamer.stop();
    streamer = null;

    console.log('Streamer stopped');
  });

  gstreamerProcess.on('error', (err) => {
    console.error('GStreamer error:', err);
  });

  gstreamerProcess.stdout.pipe(process.stdout);
  gstreamerProcess.stderr.pipe(process.stderr);

  res.end();
});

// Stop GStreamer recording
app.get('/gstreamer-stop', (req, res) => {
  if (!gstreamerProcess) {
    res.end();
    return;
  }

  gstreamerProcess.kill('SIGINT');
  gstreamerProcess = null;

  console.log('GStreamer stopped');

  res.end();
});

// Start FFMpeg recording
app.get('/ffmpeg-start', (req, res) => {
  // If there is another process running, do nothing.
  if (streamer) {
    res.end();
    return;
  }

  // Spawn FFMpeg process which will listen to RTP stream from MediaServer.
  // FFMpeg is set up to mux H264 video stream with AAC audio stream into a single MP4 file.
  // Since WebRTC normally uses Opus as audio codec, it will be transcoded into AAC by FFMpeg.
  ffmpegProcess = spawn(
    'ffmpeg',
    [
      '-protocol_whitelist pipe,rtp,udp',
      `-i -`,
      '-c:a aac',
      '-c:v copy',
      '-f mp4',
      '-y',
      `${Date.now()}.mp4`,
    ]
      .join(' ')
      .split(' ')
  );

  // Create an SDP description RTP streams
  const inputSDP = `c=IN IP4 ${STREAMER_REMOTE_IP}
    m=audio ${STREAMER_AUDIO_PORT} RTP ${STREAMER_AUDIO_PAYLOAD}
    a=rtpmap:${STREAMER_AUDIO_PAYLOAD} ${STREAMER_AUDIO_CODEC}/${STREAMER_AUDIO_CLOCKRATE}/${STREAMER_AUDIO_CHANNELS}
    m=video ${STREAMER_VIDEO_PORT} RTP ${STREAMER_VIDEO_PAYLOAD}
    a=rtpmap:${STREAMER_VIDEO_PAYLOAD} ${STREAMER_VIDEO_CODEC}/${STREAMER_VIDEO_CLOCKRATE}`;

  // Feed SDP into FFMpeg sdtin
  ffmpegProcess.stdin.write(inputSDP);
  ffmpegProcess.stdin.end();

  console.log('FFMpeg started');

  // Wait for FFMpeg to initialize and start Streamer
  ffmpegProcess.stderr.on('data', (chunk) => {
    chunk
      .toString()
      .split(/\r?\n/g)
      .forEach((line) => {
        if (line.indexOf('ffmpeg version') !== -1) {
          startStreamer();
          console.log('FFMPeg recording started');
        }
      });
  });

  ffmpegProcess.on('exit', (code, signal) => {
    console.log(`FFMpeg stopped with exit code ${code} (${signal})`);

    // Stop streamer
    streamerSessionVideo.stop();
    streamerSessionAudio.stop();
    streamer.stop();
    streamer = null;

    console.log('Streamer stopped');
  });

  ffmpegProcess.on('error', (err) => {
    console.error('FFMpeg error:', err);
  });

  ffmpegProcess.stdout.pipe(process.stdout);
  ffmpegProcess.stderr.pipe(process.stderr);

  res.end();
});

// Stop FFMpeg recording
app.get('/ffmpeg-stop', (req, res) => {
  if (!ffmpegProcess) {
    res.end();
    return;
  }

  ffmpegProcess.kill('SIGINT');
  ffmpegProcess = null;

  console.log('FFMpeg stopped');

  res.end();
});

// Start HTTP server
const listener = app.listen(process.env.PORT || 3000, () => {
  console.log(`Listening on ${ip} port ${listener.address().port}`);
});
