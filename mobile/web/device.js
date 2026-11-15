// Only public device status crosses this bridge. No persisted credential enters JS.
export function devicePanel(device){
  return '<section class="mobile-panel"><h2>Preparar Android</h2>'+
    '<p>Antes de jugar, revisá los permisos de Nexo. Podés volver a esta pantalla desde Cuenta.</p>'+
    '<p>Instalar McRust: '+(device?.installer_allowed?'autorizado':'requiere tu autorización')+'</p>'+
    '<button type="button" data-action="device-installer">Permitir instalar McRust</button>'+
    '<button type="button" data-action="device-settings">Abrir permisos de Android</button>'+
    '<p>La conexión HTTPS no necesita un permiso especial. No pedimos acceso a todos tus archivos. El micrófono se autoriza al usar una función que lo necesite.</p>'+
    '<button type="button" data-action="device-updates">Buscar actualizaciones de Nexo</button>'+
    '<p>Las actualizaciones de McRust se comprueban al pulsar Jugar. Conservá la aplicación instalada para mantener tus mundos.</p>'+
    (!device?.prepared?'<button class="primary" type="button" data-action="device-onboarding">Continuar</button>':'')+'</section>';
}
