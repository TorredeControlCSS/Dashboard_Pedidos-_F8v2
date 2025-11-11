// Variables globales
let ordersData = [];
let db;
let deferredPrompt;
const DB_NAME = 'OrdersDB';
const DB_VERSION = 1;
const STORE_NAME = 'orders';
// URL de los datos reales - REEMPLAZA CON TU URL DE GOOGLE CLOUD
const DATA_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSC_myZfLrWVb3rzsFbX_7w9nuR2zBJxEYUqMh5UcSb07hwee7_7UECeU2zTFRePSgUwpvE0IcRmTmJ/pub?gid=323536618&single=true&output=csv';

// Estados posibles para los pedidos
const ORDER_STATUSES = [
    'F8 RECIBIDA',
    'F8 RECIBIDA SIN ASIGNAR',
    'EN ASIGNACION',
    'SALIDA DE SALMI',
    'FACTURADO',
    'EMPACADO',
    'ENTREGADA'
];

// Inicialización cuando el DOM está listo
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// Inicializar la aplicación
async function initializeApp() {
    // Inicializar IndexedDB
    await initDB();
    
    // Cargar datos iniciales
    await loadData();
    
    // Configurar eventos
    setupEventListeners();
    
    // Configurar PWA
    setupPWA();
    
    // Configurar actualización automática
    setupAutoRefresh();
}

// Inicializar IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            console.error('Error al abrir la base de datos');
            reject(request.error);
        };
        
        request.onsuccess = () => {
            db = request.result;
            console.log('Base de datos abierta correctamente');
            resolve();
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Crear el almacén de objetos si no existe
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                
                // Crear índices para búsquedas
                store.createIndex('forma8Salmi', 'forma8Salmi', { unique: true });
                store.createIndex('unidadEjecutora', 'unidadEjecutora', { unique: false });
                store.createIndex('estado', 'estado', { unique: false });
            }
        };
    });
}

// Cargar datos desde la fuente externa o desde IndexedDB
async function loadData() {
    try {
        // Intentar cargar desde la fuente externa
        await fetchAndUpdateData();
        updateStatusIndicator(true);
    } catch (error) {
        console.error('Error al cargar datos externos:', error);
        
        // Si falla, cargar desde IndexedDB
        await loadFromIndexedDB();
        updateStatusIndicator(false);
        showToast('Modo offline: usando datos locales', 'error');
    }
}

// Obtener datos desde la fuente externa
async function fetchAndUpdateData() {
    showLoading(true);
    try {
        const response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        const csvText = await response.text();
        const parsedData = parseCSV(csvText);
        
        // Combinar datos: mantener los existentes y agregar nuevos
        await mergeData(parsedData);
        
        // Actualizar la tabla
        renderTable();
        
        showToast('Datos actualizados correctamente');
    } catch (error) {
        console.error('Error al obtener datos:', error);
        throw error;
    } finally {
        showLoading(false);
    }
}

// Combinar datos nuevos con existentes
async function mergeData(newData) {
    // Si no hay datos locales, usar los nuevos directamente
    if (ordersData.length === 0) {
        ordersData = newData;
        await saveToIndexedDB(ordersData);
        return;
    }

    // Crear mapa de datos existentes por Forma 8 SALMI
    const existingDataMap = new Map();
    ordersData.forEach(order => {
        existingDataMap.set(order.forma8Salmi, order);
    });

    // Combinar datos
    const mergedData = newData.map(newOrder => {
        const existingOrder = existingDataMap.get(newOrder.forma8Salmi);
        
        if (existingOrder) {
            // Mantener las ediciones del usuario pero actualizar datos base
            return {
                ...newOrder, // Datos base desde la nube
                // Mantener las ediciones del usuario
                cantidadTotalAsignada: existingOrder.cantidadTotalAsignada || newOrder.cantidadTotalAsignada,
                cantidadTotalSolicitada: existingOrder.cantidadTotalSolicitada || newOrder.cantidadTotalSolicitada,
                cantidadRenglonesAsignados: existingOrder.cantidadRenglonesAsignados || newOrder.cantidadRenglonesAsignados,
                cantidadRenglonesSolicitados: existingOrder.cantidadRenglonesSolicitados || newOrder.cantidadRenglonesSolicitados,
                fechaAsignacion: existingOrder.fechaAsignacion || newOrder.fechaAsignacion,
                fechaSalidaSalmi: existingOrder.fechaSalidaSalmi || newOrder.fechaSalidaSalmi,
                fechaDespacho: existingOrder.fechaDespacho || newOrder.fechaDespacho,
                fechaFacturacion: existingOrder.fechaFacturacion || newOrder.fechaFacturacion,
                fechaEmpacado: existingOrder.fechaEmpacado || newOrder.fechaEmpacado,
                fechaEntregaReal: existingOrder.fechaEntregaReal || newOrder.fechaEntregaReal,
                estado: existingOrder.estado || newOrder.estado,
                comentarios: existingOrder.comentarios || newOrder.comentarios
            };
        } else {
            // Nuevo pedido
            return newOrder;
        }
    });

    ordersData = mergedData;
    await saveToIndexedDB(ordersData);
}

// Analizar CSV y convertirlo en objetos
function parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    const headers = parseCSVLine(lines[0]);
    
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const order = {};
        
        // Mapear encabezados a propiedades del objeto
        headers.forEach((header, index) => {
            const key = mapHeaderToKey(header);
            order[key] = values[index] || '';
        });
        
        // Calcular campos derivados
        calculateDerivedFields(order);
        
        data.push(order);
    }
    
    return data;
}

// Función mejorada para parsear líneas CSV
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current.trim());
    return result;
}

// Mapear encabezados CSV a claves de objeto
function mapHeaderToKey(header) {
    const mapping = {
        'UNIDAD EJECUTORA': 'unidadEjecutora',
        'TIPO PEDIDO': 'tipoPedido',
        'FORMA 8 SALMI': 'forma8Salmi',
        'FORMA 8 SISCONI': 'forma8Sisconi',
        'DIVISION': 'division',
        'GRUPO': 'grupo',
        'TIPO DE SUSTANCIAS': 'tipoSustancias',
        'CANTIDAD TOTAL ASIGNADA': 'cantidadTotalAsignada',
        'CANTIDAD TOTAL SOLICITADA': 'cantidadTotalSolicitada',
        'CANTIDAD DE RENGLONES ASIGNADOS': 'cantidadRenglonesAsignados',
        'CANTIDAD DE RENGLONES SOLICITADOS': 'cantidadRenglonesSolicitados',
        'FECHA DE LA F8': 'fechaF8',
        'FECHA DE RECIBO DE LA F8': 'fechaRecepcionF8',
        'FECHA DE ASIGNACION': 'fechaAsignacion',
        'FECHA DE SALIDA EN SALMI': 'fechaSalidaSalmi',
        'FECHA DE DESPACHO': 'fechaDespacho',
        'FECHA DE FACTURACION EN COMPUTO': 'fechaFacturacion',
        'FECHA DE EMPACADO': 'fechaEmpacado',
        'FECHA PROYECTADA DE ENTREGA': 'fechaProyectadaEntrega',
        'FECHA DE ENTREGA REAL': 'fechaEntregaReal',
        'ESTADO': 'estado',
        'TIEMPO DE PROCESAMIENTO': 'tiempoProcesamiento',
        'PEDIDO COMPLETADO': 'pedidoCompletado',
        'FILL RATE POR CANTIDAD': 'fillRateCantidad',
        'FILL RATE POR RENGLON': 'fillRateRenglon',
        'COMENTARIOS': 'comentarios'
    };
    
    return mapping[header] || header.toLowerCase().replace(/ /g, '');
}

// Cargar datos desde IndexedDB
async function loadFromIndexedDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => {
            ordersData = request.result;
            if (ordersData.length > 0) {
                renderTable();
            } else {
                document.getElementById('ordersTableBody').innerHTML = `
                    <tr>
                        <td colspan="25" style="text-align: center; padding: 20px;">
                            No hay datos disponibles. Conéctese a internet para cargar los datos iniciales.
                        </td>
                    </tr>
                `;
            }
            resolve();
        };
        
        request.onerror = () => {
            console.error('Error al cargar datos desde IndexedDB');
            reject(request.error);
        };
    });
}

// Guardar datos en IndexedDB
async function saveToIndexedDB(data) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // Limpiar el almacén antes de agregar nuevos datos
        const clearRequest = store.clear();
        
        clearRequest.onsuccess = () => {
            // Agregar cada pedido con ID único
            data.forEach((order, index) => {
                order.id = order.forma8Salmi; // Usar Forma 8 SALMI como ID único
                store.add(order);
            });
        };
        
        transaction.oncomplete = () => {
            console.log('Datos guardados en IndexedDB');
            resolve();
        };
        
        transaction.onerror = () => {
            console.error('Error al guardar datos en IndexedDB');
            reject(transaction.error);
        };
    });
}

// Guardar cambios de un pedido en IndexedDB
async function saveOrderChanges(orderId, field, value) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(orderId);
        
        request.onsuccess = () => {
            const order = request.result;
            if (order) {
                order[field] = value;
                
                // Recalcular campos dependientes
                if (field.startsWith('fecha') || field === 'estado') {
                    calculateDerivedFields(order);
                }
                
                const updateRequest = store.put(order);
                
                updateRequest.onsuccess = () => {
                    // Actualizar también en memoria
                    const index = ordersData.findIndex(o => o.id === orderId);
                    if (index !== -1) {
                        ordersData[index] = order;
                    }
                    resolve();
                };
                
                updateRequest.onerror = () => {
                    reject(updateRequest.error);
                };
            } else {
                reject(new Error('Pedido no encontrado'));
            }
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Calcular campos derivados
function calculateDerivedFields(order) {
    // Calcular tiempo de procesamiento (Columna W)
    order.tiempoProcesamiento = calculateProcessingTime(order);
    
    // Calcular porcentaje de avance (Columna X)
    order.porcentajeAvance = calculateProgressPercentage(order);
    
    // Calcular cociente I/J (Columna Y)
    order.cocienteIJ = calculateRatio(
        order.cantidadTotalAsignada, 
        order.cantidadTotalSolicitada
    );
    
    // Calcular cociente K/L (Columna Z)
    order.cocienteKL = calculateRatio(
        order.cantidadRenglonesAsignados, 
        order.cantidadRenglonesSolicitados
    );
}

// Calcular tiempo de procesamiento
function calculateProcessingTime(order) {
    const fechaRecepcion = parseDate(order.fechaRecepcionF8);
    if (!fechaRecepcion) return '';
    
    // Buscar la última fecha completada
    const dateFields = [
        'fechaF8', 'fechaAsignacion', 'fechaSalidaSalmi', 
        'fechaDespacho', 'fechaFacturacion', 'fechaEmpacado', 
        'fechaProyectadaEntrega', 'fechaEntregaReal'
    ];
    
    let lastDate = fechaRecepcion;
    
    for (const field of dateFields) {
        const fieldDate = parseDate(order[field]);
        if (fieldDate && fieldDate > lastDate) {
            lastDate = fieldDate;
        }
    }
    
    // Si no hay fechas posteriores, usar la fecha actual
    if (lastDate.getTime() === fechaRecepcion.getTime()) {
        lastDate = new Date();
    }
    
    // Calcular diferencia en días
    const diffTime = Math.abs(lastDate - fechaRecepcion);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return `${diffDays} días`;
}

// Calcular porcentaje de avance
function calculateProgressPercentage(order) {
    const dateFields = [
        'fechaF8', 'fechaRecepcionF8', 'fechaAsignacion', 
        'fechaSalidaSalmi', 'fechaDespacho', 'fechaFacturacion', 
        'fechaEmpacado', 'fechaProyectadaEntrega', 'fechaEntregaReal'
    ];
    
    let completedFields = 0;
    
    for (const field of dateFields) {
        if (order[field] && order[field].trim() !== '') {
            completedFields++;
        }
    }
    
    return Math.round((completedFields / dateFields.length) * 100);
}

// Calcular cociente entre dos valores
function calculateRatio(numerator, denominator) {
    const num = parseFloat(numerator) || 0;
    const den = parseFloat(denominator) || 0;
    
    if (den === 0) return 'N/A';
    
    const ratio = num / den;
    return ratio.toFixed(2);
}

// Convertir fecha de texto a objeto Date
function parseDate(dateString) {
    if (!dateString || dateString.trim() === '') return null;
    
    // Intentar diferentes formatos de fecha
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
}

// Renderizar la tabla con los datos
function renderTable() {
    const tableBody = document.getElementById('ordersTableBody');
    tableBody.innerHTML = '';
    
    if (ordersData.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="25" style="text-align: center; padding: 20px;">
                    No hay datos disponibles
                </td>
            </tr>
        `;
        return;
    }
    
    ordersData.forEach((order, index) => {
        const row = document.createElement('tr');
        
        // Crear celdas para cada campo
        row.innerHTML = `
            <td>${order.unidadEjecutora || ''}</td>
            <td>${order.tipoPedido || ''}</td>
            <td>${order.forma8Salmi || ''}</td>
            <td>${order.division || ''}</td>
            <td>${order.grupo || ''}</td>
            <td>${order.tipoSustancias || ''}</td>
            <td><input type="number" value="${order.cantidadTotalAsignada || ''}" data-field="cantidadTotalAsignada" data-id="${order.id}"></td>
            <td><input type="number" value="${order.cantidadTotalSolicitada || ''}" data-field="cantidadTotalSolicitada" data-id="${order.id}"></td>
            <td><input type="number" value="${order.cantidadRenglonesAsignados || ''}" data-field="cantidadRenglonesAsignados" data-id="${order.id}"></td>
            <td><input type="number" value="${order.cantidadRenglonesSolicitados || ''}" data-field="cantidadRenglonesSolicitados" data-id="${order.id}"></td>
            <td><input type="date" value="${formatDateForInput(order.fechaF8)}" data-field="fechaF8" data-id="${order.id}"></td>
            <td><input type="date" value="${formatDateForInput(order.fechaRecepcionF8)}" data-field="fechaRecepcionF8" data-id="${order.id}"></td>
            <td><input type="date" value="${formatDateForInput(order.fechaAsignacion)}" data-field="fechaAsignacion" data-id="${order.id}"></td>
            <td><input type="date" value="${formatDateForInput(order.fechaSalidaSalmi)}" data-field="fechaSalidaSalmi" data-id="${order.id}"></td>
            <td><input type="date" value="${formatDateForInput(order.fechaDespacho)}" data-field="fechaDespacho" data-id="${order.id}"></td>
            <td><input type="date" value="${formatDateForInput(order.fechaFacturacion)}" data-field="fechaFacturacion" data-id="${order.id}"></td>
            <td><input type="date" value="${formatDateForInput(order.fechaEmpacado)}" data-field="fechaEmpacado" data-id="${order.id}"></td>
            <td><input type="date" value="${formatDateForInput(order.fechaProyectadaEntrega)}" data-field="fechaProyectadaEntrega" data-id="${order.id}"></td>
            <td><input type="date" value="${formatDateForInput(order.fechaEntregaReal)}" data-field="fechaEntregaReal" data-id="${order.id}"></td>
            <td>
                <select data-field="estado" data-id="${order.id}">
                    ${ORDER_STATUSES.map(status => 
                        `<option value="${status}" ${order.estado === status ? 'selected' : ''}>${status}</option>`
                    ).join('')}
                </select>
            </td>
            <td>${order.tiempoProcesamiento || ''}</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${order.porcentajeAvance || 0}%"></div>
                </div>
                <span>${order.porcentajeAvance || 0}%</span>
            </td>
            <td>${order.cocienteIJ || ''}</td>
            <td>${order.cocienteKL || ''}</td>
            <td><input type="text" value="${order.comentarios || ''}" data-field="comentarios" data-id="${order.id}"></td>
        `;
        
        tableBody.appendChild(row);
    });
    
    // Agregar event listeners a los campos editables
    addInputEventListeners();
}

// Formatear fecha para input type="date"
function formatDateForInput(dateString) {
    if (!dateString || dateString.trim() === '') return '';
    
    const date = parseDate(dateString);
    if (!date) return '';
    
    return date.toISOString().split('T')[0];
}

// Agregar event listeners a los campos editables
function addInputEventListeners() {
    const inputs = document.querySelectorAll('input, select');
    
    inputs.forEach(input => {
        input.addEventListener('change', handleInputChange);
    });
}

// Manejar cambios en los campos editables
async function handleInputChange(event) {
    const field = event.target.getAttribute('data-field');
    const id = event.target.getAttribute('data-id');
    const value = event.target.value;
    
    // Encontrar el pedido en memoria
    const orderIndex = ordersData.findIndex(order => order.id === id);
    if (orderIndex === -1) return;
    
    // Actualizar datos en memoria
    ordersData[orderIndex][field] = value;
    
    // Recalcular campos derivados si es necesario
    if (field.startsWith('fecha') || field === 'estado') {
        calculateDerivedFields(ordersData[orderIndex]);
        
        // Actualizar la fila en la tabla
        updateRow(orderIndex);
    }
    
    // Guardar cambios en IndexedDB
    try {
        await saveOrderChanges(id, field, value);
        showToast('Cambios guardados localmente');
    } catch (error) {
        console.error('Error al guardar cambios:', error);
        showToast('Error al guardar cambios', 'error');
    }
}

// Actualizar una fila específica en la tabla
function updateRow(index) {
    const order = ordersData[index];
    const row = document.querySelector(`tr:nth-child(${index + 1})`);
    
    if (row) {
        // Actualizar campos calculados
        row.cells[20].textContent = order.tiempoProcesamiento || '';
        
        const progressBar = row.cells[21].querySelector('.progress-fill');
        const progressText = row.cells[21].querySelector('span');
        
        if (progressBar && progressText) {
            progressBar.style.width = `${order.porcentajeAvance || 0}%`;
            progressText.textContent = `${order.porcentajeAvance || 0}%`;
        }
        
        row.cells[22].textContent = order.cocienteIJ || '';
        row.cells[23].textContent = order.cocienteKL || '';
    }
}

// Configurar event listeners
function setupEventListeners() {
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        try {
            await fetchAndUpdateData();
            showToast('Datos actualizados correctamente');
        } catch (error) {
            console.error('Error al actualizar datos:', error);
            showToast('Error al actualizar datos', 'error');
        }
    });
    
    document.getElementById('exportBtn').addEventListener('click', exportToCSV);
    document.getElementById('installBtn').addEventListener('click', installPWA);
}

// Exportar datos a CSV
function exportToCSV() {
    // Crear encabezados CSV
    const headers = [
        'UNIDAD EJECUTORA',
        'TIPO PEDIDO',
        'FORMA 8 SALMI',
        'DIVISION',
        'GRUPO',
        'TIPO DE SUSTANCIAS',
        'CANTIDAD TOTAL ASIGNADA',
        'CANTIDAD TOTAL SOLICITADA',
        'CANTIDAD DE RENGLONES ASIGNADOS',
        'CANTIDAD DE RENGLONES SOLICITADOS',
        'FECHA DE LA F8',
        'FECHA DE RECIBO DE LA F8',
        'FECHA DE ASIGNACION',
        'FECHA DE SALIDA EN SALMI',
        'FECHA DE DESPACHO',
        'FECHA DE FACTURACION EN COMPUTO',
        'FECHA DE EMPACADO',
        'FECHA PROYECTADA DE ENTREGA',
        'FECHA DE ENTREGA REAL',
        'ESTADO',
        'TIEMPO DE PROCESAMIENTO',
        'PORCENTAJE AVANCE',
        'COCIENTE I/J',
        'COCIENTE K/L',
        'COMENTARIOS'
    ];
    
    // Crear contenido CSV
    let csvContent = headers.join(',') + '\n';
    
    ordersData.forEach(order => {
        const row = [
            order.unidadEjecutora || '',
            order.tipoPedido || '',
            order.forma8Salmi || '',
            order.division || '',
            order.grupo || '',
            order.tipoSustancias || '',
            order.cantidadTotalAsignada || '',
            order.cantidadTotalSolicitada || '',
            order.cantidadRenglonesAsignados || '',
            order.cantidadRenglonesSolicitados || '',
            order.fechaF8 || '',
            order.fechaRecepcionF8 || '',
            order.fechaAsignacion || '',
            order.fechaSalidaSalmi || '',
            order.fechaDespacho || '',
            order.fechaFacturacion || '',
            order.fechaEmpacado || '',
            order.fechaProyectadaEntrega || '',
            order.fechaEntregaReal || '',
            order.estado || '',
            order.tiempoProcesamiento || '',
            order.porcentajeAvance || '',
            order.cocienteIJ || '',
            order.cocienteKL || '',
            order.comentarios || ''
        ];
        
        // Escapar comas en los valores
        const escapedRow = row.map(value => {
            if (value.includes(',')) {
                return `"${value}"`;
            }
            return value;
        });
        
        csvContent += escapedRow.join(',') + '\n';
    });
    
    // Crear y descargar archivo
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.setAttribute('href', url);
    link.setAttribute('download', 'pedidos_actualizados.csv');
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Archivo CSV exportado correctamente');
}

// Configurar PWA
function setupPWA() {
    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
                .then(registration => {
                    console.log('SW registrado: ', registration);
                })
                .catch(registrationError => {
                    console.log('Error al registrar SW: ', registrationError);
                });
        });
    }
    
    // Manejar evento beforeinstallprompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        
        // Mostrar botón de instalación
        document.getElementById('installBtn').style.display = 'block';
    });
    
    // Manejar evento appinstalled
    window.addEventListener('appinstalled', () => {
        console.log('PWA instalada');
        deferredPrompt = null;
        document.getElementById('installBtn').style.display = 'none';
    });
}

// Instalar PWA
function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('Usuario aceptó la instalación');
                document.getElementById('installBtn').style.display = 'none';
            }
            
            deferredPrompt = null;
        });
    }
}

// Configurar actualización automática
function setupAutoRefresh() {
    // Actualizar cada 30 minutos
    setInterval(async () => {
        try {
            await fetchAndUpdateData();
            console.log('Datos actualizados automáticamente');
        } catch (error) {
            console.error('Error en actualización automática:', error);
        }
    }, 30 * 60 * 1000); // 30 minutos
}

// Actualizar indicador de estado
function updateStatusIndicator(online) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    if (online) {
        statusDot.classList.remove('offline');
        statusText.textContent = 'Conectado';
    } else {
        statusDot.classList.add('offline');
        statusText.textContent = 'Offline';
    }
}

// Mostrar/ocultar loading
function showLoading(show) {
    const loading = document.getElementById('refreshLoading');
    const button = document.getElementById('refreshBtn');
    
    if (show) {
        loading.style.display = 'inline-block';
        button.disabled = true;
    } else {
        loading.style.display = 'none';
        button.disabled = false;
    }
}

// Mostrar notificación toast
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast';
    
    if (type === 'error') {
        toast.classList.add('error');
    }
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}