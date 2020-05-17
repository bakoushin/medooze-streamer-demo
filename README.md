# Recording audio/video streams from WebRTC using Medooze Media Server and GStreamer or FFmpeg

This demo shows how to record WebRTC video stream from the browser into an `MP4` file on the server using [Medooze Media Server](https://github.com/medooze/media-server-node) and [GStreamer](https://gstreamer.freedesktop.org/) or [FFmpeg](https://ffmpeg.org/).

Here is an overview of what is happening:

```
Client Webcam => Browser => Medooze Media Server => GStreamer|FFmpeg => .mp4
```

We are leveraging Medooze [Streamer](https://medooze.github.io/media-server-node/#streamer) component in order to send RTP streams for external processing.

## Install and run

1. Clone this repo and `cd` into project directory.

2. Install dependencies and start the server:

```
npm install
npm start
```

3. Open https://127.0.0.1:3000 in the browser.

## Recording video

1. Press `Record` button for start recording.
2. Press `Stop` button for stop recording.

A new file `<TIMESTAMP>.mp4` will be created in the project directory.

## GStreamer pipeline

Here is a quick explanation of GStreamer pipeline used in demo:

```
# Start GStreamer
gst-launch-1.0

# Gracefully save recording when GStreamer is shut down
--eos-on-shutdown

# Mux all streams into video.mp4 file
mp4mux faststart=true name=mux ! filesink location=video.mp4

# Listen to 127.0.0.1:5004 with payload 109 (audio)
udpsrc address=127.0.0.1 port=5004 caps="application/x-rtp,clock-rate=48000,payload=109" name=audio

# Get Opus audio from RTP and decode it to AAC
audio. ! queue ! rtpjitterbuffer ! rtpopusdepay ! opusdec ! audioconvert ! audioresample ! avenc_aac ! aacparse ! mux.

# Listen to 127.0.0.1:5006 with payload 96 (video)
udpsrc address=127.0.0.1 port=5006 caps="application/x-rtp,clock-rate=90000,payload=96" name=video

# Get H264 video from RTP
video. ! queue ! rtpjitterbuffer ! rtph264depay ! h264parse ! mux.
```

## FFmpeg pipeline

Here is a quick explanation of FFmpeg pipeline used in demo:

```
ffmpeg
-protocol_whitelist file,rtp,udp # Enable input from file, RTP, UDP
-i input.sdp                     # Read SDP file with RTP connection details. See example below.
-c:a aac                         # Convert incoming audio to AAC
-c:v copy                        # Copy incoming video with no changes
-f mp4                           # Output to MP4
-y                               # Non-interactive mode (always `yes`)
video.mp4                        # Output file name
```

`input.sdp`

```
c=IN IP4 127.0.0.1
m=audio 5004 RTP 109
a=rtpmap:109 opus/48000/2
m=video 5006 RTP 96
a=rtpmap:96 H264/90000
a=fmtp:96 packetization-mode=1
```

> In the actual code the SDP is created on the fly and is piped to the FFmpeg process via stdin.

## License

MIT
