'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // Create loopback video stream
  const videoLoopbackElement = document.getElementById('video-loopback');

  navigator.mediaDevices
    .getUserMedia({
      audio: true,
      video: true,
    })
    .then((cameraStream) => {
      const pc = new RTCPeerConnection({
        sdpSemantics: 'unified-plan',
      });
      cameraStream.getTracks().forEach((track) =>
        pc.addTransceiver(track, {
          direction: 'sendrecv',
          streams: [cameraStream],
        })
      );
      pc.addEventListener('track', (e) => {
        videoLoopbackElement.srcObject = e.streams[0];
      });
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() =>
          fetch('/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: pc.localDescription.sdp,
          })
        )
        .then((res) => {
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          return res.json();
        })
        .then((answer) => pc.setRemoteDescription(answer))
        .catch((err) => console.error(err));
    });
});
