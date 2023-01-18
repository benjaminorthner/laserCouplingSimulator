import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'lil-gui'
import { MeshStandardMaterial, StaticDrawUsage, TangentSpaceNormalMap, Vector3 } from 'three'

// THE ANGLE OF THE CONE AT WHICH THE FIBER WILL ALLOW LIGHT TO PASS THOUGH IS CALLED THE ACCEPTANCE CONE https://www.fiberoptics4sale.com/blogs/archive-posts/95146054-optical-fiber-tutorial-optic-fiber-communication-fiber
// optical fiber power loss mechanisms:
// https://www.fiberoptics4sale.com/blogs/archive-posts/95048006-optical-fiber-loss-and-attenuation

/**
 * Base
 */
// Debug
const gui = new dat.GUI()

// Canvas
const canvas = document.querySelector('canvas.webgl')

// Scene
const scene = new THREE.Scene()

/**
 * Textures
 */
const textureLoader = new THREE.TextureLoader()


const sourcePos = new THREE.Vector3(1,1,0)

/**
 * LaserPointer
 **/ 
const laserPointer = new THREE.Group()
scene.add(laserPointer)

const laserPointerMaterial = new THREE.MeshStandardMaterial({color: 0x706666})
const laserPointerLength = 1
const laserPointerRadius = 0.05

const laserPointerBody = new THREE.Mesh(
    new THREE.CylinderGeometry(laserPointerRadius, laserPointerRadius, laserPointerLength, 80),
    laserPointerMaterial
)
laserPointer.add(laserPointerBody)

// laser Pointer Rim
const rimLength = laserPointerLength * 0.1
var extrudeSettings = {
    amount : rimLength,
    steps : 1,
    bevelEnabled: false,
    bevelSize: 0.005,
    curveSegments: 80
};

var arcShape = new THREE.Shape();
arcShape.absarc(0, 0, laserPointerRadius * 1.1, 0, Math.PI * 2, 0, false);

var holePath = new THREE.Path();
holePath.absarc(0, 0, laserPointerRadius * 0.5, 0, Math.PI * 2, true);
arcShape.holes.push(holePath);

const laserPointerRim = new THREE.Mesh(
    new THREE.ExtrudeGeometry(arcShape, extrudeSettings),
    laserPointerMaterial
)
laserPointerRim.rotateX(Math.PI / 2)
laserPointerRim.position.y = laserPointerLength / 2 + rimLength / 2

laserPointer.add(laserPointerRim)


laserPointer.position.y = sourcePos.y 
laserPointer.position.x= sourcePos.x + laserPointerLength / 2
laserPointer.position.z= sourcePos.z
laserPointer.rotateZ(Math.PI / 2)

// Mirrors

class Mirror {
    constructor(position, normal) {
        this.position = position
        this.normal = normal.normalize()

        this.mirrorRadius = 0.25
        this.mirrorMaterial = new THREE.MeshStandardMaterial({roughness : 0})
        this.squareMaterial = new THREE.MeshStandardMaterial({roughness: 0.7, color: 0x888888})

        this.mirror = new THREE.Group()

        this.circle = new THREE.Mesh(
            new THREE.CylinderGeometry(this.mirrorRadius, this.mirrorRadius, 0.05, 100),
            this.mirrorMaterial
        )



        this.square = new THREE.Mesh(
            new THREE.BoxGeometry(this.mirrorRadius * 2.3, 0.03, this.mirrorRadius * 2.3),
            this.squareMaterial
        ) 
        this.square.position.y -= 0.015

        this.mirror.add(this.circle)

        this.mirror.position.x = position.x
        this.mirror.position.y = position.y
        this.mirror.position.z = position.z

        this.mirror.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.normal.clone().normalize())

        // create a list of all mirror instances
        // only add circles since those are colliding
        if(!Mirror.allInstances) { Mirror.allInstances = [] }
        Mirror.allInstances.push(this)

        scene.add(this.mirror)
    }

    setNormal(newNormal) {
        this.normal = newNormal.clone().normalize()
        this.mirror.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.normal.clone().normalize())

        // update lasers
        LaserBeam.allInstances.forEach(laserBeam => {
           laserBeam.update() 
        });
    }
}


class LaserBeam {
    constructor(origin, originDirection, color) {
        this.origin = origin
        this.originDirection = originDirection
        this.maxBounces = 5

        this.laserMaterial = new THREE.MeshStandardMaterial({color: color, emissive: 0xff0000, transparent: true, opacity: 0.7})
        this.beamThickness = 0.007
        this.beamList = []

        // create list of al LaserBeam instances
        if(!LaserBeam.allInstances) { LaserBeam.allInstances = [] }
        LaserBeam.allInstances.push(this)
    }

    update() {
        this.clearLasers()

        const currentPosition = this.origin.clone()
        const currentDirection = this.originDirection.clone()

        // loop over all bounces
        for (let i = 0; i < this.maxBounces; i++) {
            // cast the current beam
            const castReturn = this.cast(currentPosition, currentDirection)
            const keepBouncing = castReturn[0]
            const newPosition = castReturn[1]
            const newDirection = castReturn[2]

            // draw the current beam
            this.drawLaser(currentPosition, newPosition)
            
            // if keepBouncing is false then break
            if (!keepBouncing) {break}

            currentPosition.copy(newPosition)
            currentDirection.copy(newDirection)
        }
    }

    cast(position, direction) {
        const raycaster = new THREE.Raycaster
        direction.normalize()

        //TODO must initialise raycaster a bit along its direction otherwise it immeditely intersects the previous mirror
        raycaster.set(position, direction)

        // get mirror instances and split into mirror meshes and normals
        const mirrorMeshes = []
        const mirrorNormals  = []
        Mirror.allInstances.forEach(instance => {
            mirrorMeshes.push(instance.circle) 
            mirrorNormals.push(instance.normal)
        });

        // check which meshes are intersected by the ray
        const mirrorIntersects = raycaster.intersectObjects(mirrorMeshes)
        const fiberIntersect = raycaster.intersectObject(Fiber.instance.circle)

        // check if fiber has been reached
        if (fiberIntersect.length != 0) {
            this.computeCouplingPower(direction)
            return [false, fiberIntersect[0].point, direction]
        }

        // if no mirror is hit
        if (mirrorIntersects.length == 0) {
            const newPosition = position.clone()
            newPosition.addScaledVector(direction, 100)
            this.couplingPower = 0.
            return [false, newPosition, direction]
        }

        // if a mirror is hit
        const intersect = mirrorIntersects[0]

        const intersectNormal = mirrorNormals[mirrorMeshes.findIndex((mesh) => {return mesh.uuid == intersect.object.uuid})]
        const intersectPoint = intersect.point
        
        const newDirection = direction.clone()
        newDirection.reflect(intersectNormal)

        return [true, intersectPoint, newDirection]
    
    }

    drawLaser(p1, p2) {
        const beam = new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.LineCurve3(p1, p2), 20, this.beamThickness, 8),
            this.laserMaterial
        )
        this.beamList.push(beam)
        scene.add(beam)
    }

    clearLasers() {
        this.beamList.forEach(beam => {
            scene.remove(beam)
        });
        this.beamList = []
    }

    computeCouplingPower(laserDirection){
        this.couplingPower = -1 * laserDirection.dot(Fiber.instance.normal)
    }
}

class Fiber {
    constructor(position, normal, acceptanceAngle) {
        this.position = position
        this.normal = normal
        this.acceptanceAngle = acceptanceAngle

        // add instance as class attribute to access in laserBeam
        Fiber.instance = this

        const cableMaterial = new MeshStandardMaterial({color: 0x9999cc})
        const cableThickness = 0.01

        const circleMaterial = new MeshStandardMaterial({color: 0x666666})
        const coneMaterial = new MeshStandardMaterial({color: 0x0000ff, transparent: true, opacity: 0.3})
        coneMaterial.side = THREE.DoubleSide

        const fiber = new THREE.Group()
        scene.add(fiber)

        // ENTRANCE CIRCLE
        const circleRadius = 0.03
        const circleThickness = circleRadius * 1.5
        this.circle = new THREE.Mesh(
            new THREE.CylinderGeometry(circleRadius, cableThickness, circleThickness, 50),
            circleMaterial
        )
        fiber.add(this.circle)
        

        // ACCEPTANCE CONE

        // calculate radius and height of cone from acceptanceangle
        const coneHeight = 1
        const coneRadius = coneHeight * Math.atan(acceptanceAngle)
        const acceptanceCone = new THREE.Mesh(
            new THREE.ConeGeometry(coneRadius, coneHeight, 20, 1, true),
            coneMaterial
        )
        // position the acceptance cone
        acceptanceCone.position.y += coneHeight / 2 + circleThickness / 2
        acceptanceCone.rotateZ(Math.PI)
        fiber.add(acceptanceCone)

        // positioning
        fiber.position.x = position.x
        fiber.position.y = position.y
        fiber.position.z = position.z
        
        fiber.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.normal.clone().normalize())

        // FIBER CABLE
        const p1 = fiber.position
        const p2 = p1.clone().addScaledVector(normal, -0.2)
        const p3 = p2.clone().multiply(new THREE.Vector3(1, 0.2, 1))
        const p4 = p3.clone().addScaledVector(new THREE.Vector3(0,0,-1), 0.1)

        const cableCurve = new THREE.CatmullRomCurve3( [
                p1,
                p2,
                p3,
                p4
            ] );
        
        const cable = new THREE.Mesh(
            new THREE.TubeGeometry(cableCurve, 100, cableThickness),
            cableMaterial
        )
        scene.add(cable)
        }
    }

const axesHelper = new THREE.AxesHelper( 5 );
scene.add( axesHelper );

const mirror1 = new Mirror(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 1))
const mirror2 = new Mirror(new THREE.Vector3(0, 1, 1), new THREE.Vector3(1, 0, -1))

const laserBeam = new LaserBeam(sourcePos, new Vector3(-1, 0, 0), 0xff0000)

const fiberPos = new THREE.Vector3(2, 1, 1)
const fiberNormal = new THREE.Vector3(-1, 0, 0)
const fiber = new Fiber(fiberPos, fiberNormal, 0.02)

const backLaserBeam = new LaserBeam(fiberPos, fiberNormal, 0x00ff00)

// Floor
const floor = new THREE.Mesh(
    new THREE.BoxGeometry(20, 20, 1),
    new THREE.MeshStandardMaterial({ color: '#a9c388' })
)
floor.rotation.x = - Math.PI * 0.5
floor.position.y = - 1 / 2
scene.add(floor)

/**
 * Lights
 */
// Ambient light
const ambientLight = new THREE.AmbientLight('#ffffff', 0.5)
gui.add(ambientLight, 'intensity').min(0).max(1).step(0.001)
scene.add(ambientLight)

// Directional light
const moonLight = new THREE.DirectionalLight('#ffffff', 0.5)
moonLight.position.set(4, 5, - 2)
gui.add(moonLight, 'intensity').min(0).max(1).step(0.001)
gui.add(moonLight.position, 'x').min(- 5).max(5).step(0.001)
gui.add(moonLight.position, 'y').min(- 5).max(5).step(0.001)
gui.add(moonLight.position, 'z').min(- 5).max(5).step(0.001)
scene.add(moonLight)

// GUI MIRRORS
const mirror1Angles = new THREE.Vector3(1, 0, 1)
gui.add(mirror1Angles, 'x').min(0.9).max(1.1).step(0.001)
gui.add(mirror1Angles, 'y').min(-0.1).max(0.1).step(0.001)
gui.add(mirror1Angles, 'z').min(0.9).max(1.1).step(0.001)

const mirror2Angles = new THREE.Vector3(1, 0, -1)
gui.add(mirror2Angles, 'x').min(0.9).max(1.1).step(0.001)
gui.add(mirror2Angles, 'y').min(-0.1).max(0.1).step(0.001)
gui.add(mirror2Angles, 'z').min(-1.1).max(-0.9).step(0.001)

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

window.addEventListener('resize', () =>
{
    // Update sizes
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    // Update camera
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    // Update renderer
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 100)
camera.position.x = 4
camera.position.y = 2
camera.position.z = 5
scene.add(camera)

// Controls
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas
})
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

/**
 * Animate
 */
const clock = new THREE.Clock()


const tick = () =>
{
    const elapsedTime = clock.getElapsedTime()

    // Update controls
    controls.update()
    
    // Render
    renderer.render(scene, camera)

    // update mirror controls
    mirror1.setNormal(mirror1Angles)
    mirror2.setNormal(mirror2Angles)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()