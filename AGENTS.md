# AGENTS

## Tareas de codificación

Cuando se inicien sesiones de Claude Code para trabajar en codificación, indique a la sesión que utilice las habilidades de **gstack**.

### Ejemplos de uso

#### Auditoría de seguridad
```
Cargar gstack. Ejecutar /cso
```

#### Revisión de código
```
Cargar gstack. Ejecutar /review
```

#### Prueba de control de calidad de una URL
```
Cargar gstack. Ejecutar /qa https://...
```

#### Compilar una funcionalidad de extremo a extremo
```
Cargar gstack. Ejecutar /autoplan, implementar el plan, luego ejecutar /ship
```

#### Planificar antes de compilar
```
Cargar gstack. Ejecutar /office-hours luego /autoplan. Guardar el plan, no implementar.
```

## Memoria persistente (Engram)

- Clave canónica del proyecto: `proyecto-p2p` (fijada en `.engram/config.json`).
- El servidor Engram se ejecuta desde el directorio de instalación de Antigravity. Llamar siempre a `mem_current_project` con `cwd` igual a la raíz del repositorio (`E:\05_Proyectos\proyecto p2p`); sin ese parámetro resuelve el proyecto `antigravity` por error.
- Pasar `project: "proyecto-p2p"` explícito en `mem_save`, `mem_search` y `mem_context`.
- Las claves heredadas `proyecto p2p` (con espacio) y `antigravity` contienen memorias históricas de este proyecto; consultarlas solo como lectura hasta su consolidación.
