fetch("https://geoportal.esdm.go.id/geoserver/wfs", { method: 'OPTIONS' })
  .then(res => console.log(res.headers.get('access-control-allow-origin')))
  .catch(err => console.error(err.message));
