const { createApp } = Vue;

createApp({
  data() {
    return {
      servers: [],
      chart: null,
    };
  },
  mounted() {

    const socket = io('http://localhost:5000');
    socket.on('update', (data) => {
      this.servers = data.servers;
      this.updateChart(); // Actualiza el gráfico cada vez que reciba datos
    });

    this.loadLogs(); // Carga los logs del servidor
  },
  methods: {
    async loadLogs() {
      try {
        const response = await fetch("http://localhost:5000/status");
        if (!response.ok) throw new Error("Network response was not ok");
        const data = await response.json();
        this.servers = data.servers;
        this.updateChart();
      } catch (error) {
        console.error("Error loading logs:", error);
      }
    },
    initializeChart() {
      const ctx = document.getElementById('statusChart').getContext('2d');
      this.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [], // Etiquetas del tiempo
          datasets: [] // Conjuntos de datos vacíos que se llenarán dinámicamente
        },
        options: {
          scales: {
            x: {
              title: {
                display: true,
                text: 'Tiempo'
              }
            },
            y: {
              title: {
                display: true,
                text: 'Estado'
              },
              ticks: {
                callback: function (value) {
                  return value >= 1 ? 'Up' : 'Down'; // Mostrar "Up" o "Down"
                },
                stepSize: 1,
              },
              min: 0,
              max: 1.01
            }
          }
        }
      });
    },
    updateChart() {
      if (!this.chart) return;

      if (this.servers.length === 0 || !this.servers[0]?.history) return;

      // Buscar el servidor con mas marcas de tiempo y basarse en esa cantidad.
      const generalTimestamps = this.servers.reduce((prev, current) => {
        return (prev.history.length > current.history.length) ? prev : current;
      });

      const timestamps = generalTimestamps.history.map(h => h.timestamp);

      // Crear datasets para cada servidor
      const datasets = this.servers.map(server => {
        return {
          label: server.instance,
          data: server.history.map(h => h.status === 'up' ? 1 : 0), // Convertir "up" a 1 y "down" a 0
          borderColor: this.getRandomColor(),
          fill: false
        };
      });

      // Actualiza los datos del gráfico
      this.chart.data.labels = timestamps;
      this.chart.data.datasets = datasets;
      this.chart.update(); // Redibuja el gráfico
    },
    getRandomColor() {
      const letters = '0123456789ABCDEF';
      let color = '#';
      for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
      }
      return color;
    }
  }
}).mount("#app");
