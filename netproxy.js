#!/usr/bin/env node

const net = require( "net" )
const fs = require( "fs" )
const os = require( "os" )
const path = require( "path" )
const url = require( "url" )
const lodash = require( "lodash" )
const stream = require( "stream" )
const Promise = require( "bluebird" )
const defaultPorts = require( "./defaultPorts" )

Promise.coroutine.addYieldHandler( Promise.resolve )

const readConfig = p => {
	let c
	try {
		c = fs.readFileSync( path.join( p, `.netproxyrc` ) )
	}
	catch ( e ) {
		return undefined
	}
	return JSON.parse( String( c ).trim() )
}

const config = function () {
	if ( process.argv.length < 3 ) {
		for ( let q, p = process.cwd(); q !== p; q = p, p = path.resolve( p, `..` ) ) {
			const c = readConfig( p )
			if ( c !== undefined )
				return c
		}
		const c = readConfig( path.join( os.homedir() ) )
		if ( c !== undefined )
			return c
	}
	const c = {}
	for ( let i = 2; i < process.argv.length; i += 2 )
		c[ process.argv[ i ] ] = process.argv[ i + 1 ]
	return c
}()

const parse = str =>
	/^\d+$/.test( str )
	? parse( `[::]:${ str }` )
	: !/:\/\//.test( str )
	? parse( `tcp://${ str }` )
	: lodash.pick( url.parse( str ), [ `protocol`, `slashes`, `auth`, `hostname`, `port`, `pathname`, `search`, `hash` ] )

function connect( udest ) {
	switch ( udest.protocol ) {
		case `tcp:`: {
			return new Promise( resolve => {
				const ret = net.connect( udest.port, udest.hostname, () => resolve( ret ) )
				ret.on( `error`, error => resolve( Promise.reject( error ) ) )
			} )
			break
		}
		default: {
			console.error( `Unsupported protocol: ${ url.format( udest ) }` )	
		}
	}
}

const pstream = stream => new Promise( resolve => {
	stream.on( `error`, error => resolve( Promise.reject( error ) ) )
	stream.on( `end`, () => resolve() )
} )

const pipe = Promise.coroutine( function* ( source, dest ) {
	try {
		dest = yield dest
		if ( dest ) {
			try {
				dest.pipe( source )
				source.pipe( dest )
				yield pstream( source )
				yield pstream( dest )
			}
			finally {
				dest.end()
			}
		}
	}
	finally {
		source.end()
	}
} )

for ( const [ source, dest ] of Object.entries( config ) ) {
	const onError = error => console.error( error )
	const usource = parse( source )
	const udest = parse( dest )
	for ( const u of [ usource, udest ] ) {
		if ( u.port == null && u.protocol )
			u.port = defaultPorts[ u.protocol ]
		if ( u.port )
			u.port = parseInt( u.port )
		if ( u.protocol === `tcpip:` )
			u.protocol = `tcp:`
	}
	if ( udest.port == null && udest.protocol === `tcp:` )
		udest.port = usource.port
	switch ( usource.protocol ) {
		case `tcp:`: {
			net.createServer( sourceSocket => pipe( sourceSocket, connect( udest ) ).catch( onError ) )
			.on( `error`, onError )
			.listen( usource.port )
			break
		}
		default: {
			console.error( `Unsupported protocol: ${ url.format( usource ) }` )
		}
	}
	console.log( `${ url.format( usource ) } -> ${ url.format( udest ) }` )
}
