#!/usr/bin/env node

require( "core-js" )
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

const parseMultiPorts = str =>
	/(\d+\,)+\d+/.test( str )
	? str.match( /\d+/g ).map( parse )
	: [ parse( str ) ]

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
				yield Promise.all( [ pstream( source ), pstream( dest ) ] )
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
	const usource = parseMultiPorts( source )
	const udest = parse( dest )

	for ( const u of [ ...usource, udest ] ) {
		if ( u.port == null && u.protocol )
			u.port = defaultPorts[ u.protocol ]
		if ( u.port )
			u.port = parseInt( u.port )
		if ( u.protocol === `tcpip:` )
			u.protocol = `tcp:`
	}

	for ( const s of usource ) {
		let d = udest
		if ( d.port == null && d.protocol === `tcp:` )
			d = Object.assign( {}, d, { port: s.port } )
		switch ( s.protocol ) {
			case `tcp:`: {
				net.createServer( sourceSocket => pipe( sourceSocket, connect( d ) ).catch( onError ) )
				.on( `error`, onError )
				.listen( s.port )
				break
			}
			default: {
				console.error( `Unsupported protocol: ${ url.format( s ) }` )
			}
		}
		console.log( `${ url.format( s ) } -> ${ url.format( d ) }` )
	}
}
